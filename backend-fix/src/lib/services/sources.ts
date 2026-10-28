// 사업 모델 추출용 원본 자료 모으기: 텍스트, 웹사이트, 피치덱(PDF), 사진.
import "server-only";
import { extractText, getDocumentProxy } from "unpdf";
import type { Db } from "../supabase/server";
import type { LlmImage } from "../llm/client";
import { badRequest } from "../api/handler";
import { safeFetch, UnsafeUrlError, type SafeResponse } from "../net/safeFetch";

const MAX_CHARS = 60_000;
const MAX_IMAGES = 5;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export interface SourceInput {
  text?: string;
  urls?: string[];
  /** source-files 버킷 안의 경로 (<project_id>/...) */
  files?: string[];
}

export interface Material {
  text: string;
  images: LlmImage[];
  notes: string[];
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchSite(raw: string): Promise<string> {
  let target = raw;
  let res: SafeResponse | null = null;
  // 리다이렉트를 직접 따라가며 매번 공개 주소인지 확인한다 (최대 3번). 연결 순간의 DNS 결과도 safeFetch가 검사한다.
  for (let hop = 0; hop < 4; hop++) {
    try {
      res = await safeFetch(target, {
        allowHttp: true,
        timeoutMs: 15_000,
        maxBytes: 2_000_000,
        headers: { "user-agent": "ValidationServiceBot/0.1", accept: "text/html,text/plain" },
      });
    } catch (e) {
      if (e instanceof UnsafeUrlError) throw badRequest(e.message);
      throw e;
    }
    const loc = res.status >= 300 && res.status < 400 ? res.headers.location : undefined;
    if (!loc) break;
    target = new URL(String(loc), target).toString();
  }
  if (!res || !res.ok) throw new Error(`${res?.status ?? "요청 실패"}`);
  const type = String(res.headers["content-type"] ?? "");
  if (!type.includes("text/html") && !type.includes("text/plain")) throw new Error(`지원하지 않는 형식 ${type}`);
  const body = await res.text();
  return type.includes("html") ? htmlToText(body) : body;
}

export async function gatherMaterial(admin: Db, projectId: string, input: SourceInput): Promise<Material> {
  const parts: string[] = [];
  const images: LlmImage[] = [];
  const notes: string[] = [];

  if (input.text?.trim()) parts.push(`[아이디어 설명]\n${input.text.trim()}`);

  for (const u of input.urls ?? []) {
    try {
      parts.push(`[웹사이트 ${u}]\n${(await fetchSite(u)).slice(0, 20_000)}`);
    } catch (e) {
      notes.push(`웹사이트를 읽지 못했다: ${u} (${e instanceof Error ? e.message : e})`);
    }
  }

  // 경로는 이 프로젝트에 올린 원본 자료 목록에 있는 것만 받는다 (../ 같은 경로 조작으로 다른 파일을 읽지 못하게)
  const asked = input.files ?? [];
  const known = new Set<string>();
  if (asked.length) {
    const { data, error } = await admin.from("source_files").select("storage_path").eq("project_id", projectId).in("storage_path", asked);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as Array<{ storage_path: string }>) known.add(r.storage_path);
  }
  for (const path of asked) {
    if (!known.has(path) || !/^[0-9a-f-]{36}\/[^/\\]+$/.test(path) || path.includes("..")) throw badRequest("이 프로젝트에 올린 파일만 쓸 수 있다");
    const { data, error } = await admin.storage.from("source-files").download(path);
    if (error || !data) {
      notes.push(`파일을 찾지 못했다: ${path}`);
      continue;
    }
    const type = data.type || "";
    if (type === "application/pdf" || path.toLowerCase().endsWith(".pdf")) {
      const pdf = await getDocumentProxy(new Uint8Array(await data.arrayBuffer()));
      const { text } = await extractText(pdf, { mergePages: true });
      parts.push(`[피치덱 ${path.split("/").pop()}]\n${String(text).slice(0, 30_000)}`);
    } else if (IMAGE_TYPES.has(type)) {
      if (images.length >= MAX_IMAGES) {
        notes.push(`사진은 ${MAX_IMAGES}장까지만 분석한다: ${path}`);
        continue;
      }
      images.push({ mediaType: type as LlmImage["mediaType"], data: Buffer.from(await data.arrayBuffer()).toString("base64") });
    } else if (type.startsWith("text/")) {
      parts.push(`[파일 ${path.split("/").pop()}]\n${(await data.text()).slice(0, 20_000)}`);
    } else {
      notes.push(`지원하지 않는 파일 형식: ${path} (${type})`);
    }
  }

  const text = parts.join("\n\n").slice(0, MAX_CHARS);
  if (!text && images.length === 0) throw badRequest("아이디어 설명, 웹사이트, 피치덱, 사진 중 하나는 필요하다");
  return { text: text || "(사진 자료만 있음)", images, notes };
}
