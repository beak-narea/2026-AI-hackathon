// 사업 모델 추출용 원본 자료 모으기: 텍스트, 웹사이트, 피치덱(PDF), 사진.
import "server-only";
import { lookup } from "node:dns/promises";
import { extractText, getDocumentProxy } from "unpdf";
import type { Db } from "../supabase/server";
import type { LlmImage } from "../llm/client";
import { badRequest } from "../api/handler";

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

const PRIVATE_V4 = /^(127\.|10\.|192\.168\.|169\.254\.|0\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)|^172\.(1[6-9]|2\d|3[01])\./;

function isPrivateAddress(addr: string): boolean {
  if (addr.includes(":")) {
    const a = addr.toLowerCase();
    return a === "::1" || a.startsWith("fc") || a.startsWith("fd") || a.startsWith("fe80") || a.startsWith("::ffff:127.");
  }
  return PRIVATE_V4.test(addr);
}

function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest(`URL 형식이 아니다: ${raw}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw badRequest("http(s) 주소만 받는다");
  const host = url.hostname;
  // 서버 내부망 접근(SSRF) 차단
  if (
    host === "localhost" ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.endsWith(".internal") ||
    host === "[::1]"
  ) {
    throw badRequest("내부 주소는 가져올 수 없다");
  }
  return url;
}

async function fetchSite(raw: string): Promise<string> {
  let url = assertPublicHttpUrl(raw);
  let res: Response | null = null;
  // 리다이렉트를 직접 따라가며 매번 내부 주소인지 확인한다 (최대 3번)
  for (let hop = 0; hop < 4; hop++) {
    const addresses = await lookup(url.hostname, { all: true });
    if (addresses.some((a) => isPrivateAddress(a.address))) throw new Error("내부 주소로 연결된다");
    res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { "user-agent": "ValidationServiceBot/0.1" } });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!next) break;
    url = assertPublicHttpUrl(new URL(next, url).toString());
  }
  if (!res || !res.ok) throw new Error(`${res?.status ?? "요청 실패"}`);
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("text/html") && !type.includes("text/plain")) throw new Error(`지원하지 않는 형식 ${type}`);
  const body = (await res.text()).slice(0, 2_000_000);
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

  for (const path of input.files ?? []) {
    if (!path.startsWith(`${projectId}/`)) throw badRequest("다른 프로젝트의 파일은 쓸 수 없다");
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
