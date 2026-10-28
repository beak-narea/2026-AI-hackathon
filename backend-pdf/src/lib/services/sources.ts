// 사업 모델 추출용 원본 자료 모으기: 텍스트, 웹사이트, 피치덱(PDF), 사진.
import "server-only";
import { extractText, getDocumentProxy } from "unpdf";
import { PDFDocument } from "pdf-lib";
import type { Db } from "../supabase/server";
import type { LlmDocument, LlmImage } from "../llm/client";
import { badRequest } from "../api/handler";
import { safeFetch, UnsafeUrlError, type SafeResponse } from "../net/safeFetch";

const MAX_CHARS = 60_000;
const MAX_IMAGES = 5;
/** Claude에 PDF 원본으로 보내는 한도: 요청 하나에 32MB·100쪽(모든 PDF 합계). base64로 4/3배 늘고 사진도 함께 가므로 원본 합계 18MB까지 */
const DOC_BYTES_BUDGET = 18 * 1024 * 1024;
const DOC_PAGES_BUDGET = 100;

/** 앞쪽부터 최대 maxPages쪽, maxBytes 이하로 잘라 새 PDF를 만든다. 암호가 걸렸거나 한 쪽도 안 들어가면 null */
export async function slicePdf(buf: Uint8Array, maxPages: number, maxBytes: number): Promise<{ bytes: Uint8Array; pages: number; total: number } | null> {
  let src: PDFDocument;
  try {
    src = await PDFDocument.load(buf, { updateMetadata: false });
  } catch {
    return null;
  }
  const total = src.getPageCount();
  if (total <= maxPages && buf.length <= maxBytes) return { bytes: buf, pages: total, total };
  let n = Math.min(total, maxPages);
  while (n >= 1) {
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, Array.from({ length: n }, (_, i) => i));
    copied.forEach((p) => out.addPage(p));
    const bytes = await out.save();
    if (bytes.length <= maxBytes) return { bytes, pages: n, total };
    // 쪽당 크기가 비슷하다고 보고 줄인다 (그래도 크면 다시)
    n = Math.min(n - 1, Math.floor((n * maxBytes) / bytes.length * 0.9));
  }
  return null;
}
/** Claude 이미지 한도: 한 장 5MB. 긴 변 1568px이면 충분히 읽는다 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_EDGE = 1568;
const IMAGE_EXT: Record<string, LlmImage["mediaType"]> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

/** 저장소가 돌려준 형식이 비었거나 octet-stream이어도 확장자로 알아본다 */
export function sourceType(path: string, blobType: string): "pdf" | "image" | "text" | "other" {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  if (blobType === "application/pdf" || ext === "pdf") return "pdf";
  if (blobType.startsWith("image/") || ext in IMAGE_EXT) return "image";
  if (blobType.startsWith("text/") || ext === "txt" || ext === "md") return "text";
  return "other";
}

/** 사진을 Claude가 받는 크기로 줄인다 (sharp가 없으면 원본 크기 그대로, 5MB를 넘으면 건너뛴다) */
async function prepareImage(buf: Buffer, path: string, blobType: string): Promise<LlmImage | string> {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  const original = (IMAGE_EXT[ext] ?? (blobType in { "image/png": 1, "image/jpeg": 1, "image/webp": 1, "image/gif": 1 } ? blobType : "image/jpeg")) as LlmImage["mediaType"];
  try {
    const sharp = (await import("sharp")).default;
    const out = await sharp(buf, { failOn: "none" })
      .rotate()
      .resize({ width: IMAGE_EDGE, height: IMAGE_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { mediaType: "image/jpeg", data: out.toString("base64") };
  } catch {
    if (buf.length > MAX_IMAGE_BYTES) return `사진이 5MB를 넘어 분석하지 못했다: ${path.split("/").pop()} (작게 줄여 다시 올린다)`;
    return { mediaType: original, data: buf.toString("base64") };
  }
}

export interface SourceInput {
  text?: string;
  urls?: string[];
  /** source-files 버킷 안의 경로 (<project_id>/...) */
  files?: string[];
}

export interface Material {
  text: string;
  images: LlmImage[];
  documents: LlmDocument[];
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
  const documents: LlmDocument[] = [];
  let docPagesLeft = DOC_PAGES_BUDGET;
  let docBytesLeft = DOC_BYTES_BUDGET;
  for (const path of asked) {
    if (!known.has(path) || !/^[0-9a-f-]{36}\/[^/\\]+$/.test(path) || path.includes("..")) throw badRequest("이 프로젝트에 올린 파일만 쓸 수 있다");
    const name = path.split("/").pop() ?? path;
    const { data, error } = await admin.storage.from("source-files").download(path);
    if (error || !data) {
      notes.push(`파일을 찾지 못했다: ${name}`);
      continue;
    }
    const blobType = data.type || "";
    const kind = sourceType(path, blobType);
    const buf = Buffer.from(await data.arrayBuffer());
    if (kind === "pdf") {
      let pageTexts: string[] = [];
      try {
        const pdf = await getDocumentProxy(new Uint8Array(buf));
        pageTexts = ((await extractText(pdf, { mergePages: false })).text as string[]).map((t) => String(t ?? "").trim());
      } catch (e) {
        notes.push(`PDF 글자를 읽지 못했다: ${name} (${(e as Error).message})`);
      }
      const joinPages = (from: number, to?: number) =>
        pageTexts.slice(from, to).map((t, i) => (t ? `(${from + i + 1}쪽) ${t}` : "")).filter(Boolean).join("\n");
      // 원본 PDF를 보내면 글자가 그림으로만 된 쪽(스캔본·디자인 툴 내보내기)도 읽는다.
      // 한도를 넘는 큰 PDF는 앞쪽을 원본으로, 나머지 쪽은 글자로 보낸다.
      const slice = docPagesLeft > 0 && docBytesLeft > 0 ? await slicePdf(new Uint8Array(buf), docPagesLeft, docBytesLeft) : null;
      if (slice) {
        docPagesLeft -= slice.pages;
        docBytesLeft -= slice.bytes.length;
        const whole = slice.pages === slice.total;
        documents.push({ mediaType: "application/pdf", data: Buffer.from(slice.bytes).toString("base64"), title: whole ? name : `${name} (1~${slice.pages}쪽)` });
        const sent = joinPages(0, slice.pages);
        const rest = whole ? "" : joinPages(slice.pages);
        parts.push(
          `[피치덱 ${name}] ${whole ? "PDF 원본을 함께 보낸다." : `전체 ${slice.total}쪽 가운데 1~${slice.pages}쪽은 PDF 원본으로 함께 보낸다.`}` +
            (sent ? `\n(원본에서 뽑은 글자 일부)\n${sent.slice(0, 4_000)}` : "") +
            (rest ? `\n(${slice.pages + 1}쪽부터 뽑은 글자)\n${rest.slice(0, 30_000)}` : ""),
        );
        if (!whole) notes.push(`PDF가 커서 ${name}의 1~${slice.pages}쪽은 원본으로, 나머지 ${slice.total - slice.pages}쪽은 글자만 읽었다 (그림 속 글자는 빠짐)`);
      } else {
        const text = joinPages(0);
        if (text) {
          parts.push(`[피치덱 ${name}]\n${text.slice(0, 30_000)}`);
          notes.push(`PDF 원본을 보낼 여유가 없어 글자만 읽었다 (그림 속 글자는 빠짐): ${name}`);
        } else {
          notes.push(`PDF에서 글자를 찾지 못했다 (암호가 걸렸거나 한 쪽이 너무 큰 스캔본): ${name}`);
        }
      }
    } else if (kind === "image") {
      if (images.length >= MAX_IMAGES) {
        notes.push(`사진은 ${MAX_IMAGES}장까지만 분석한다: ${name}`);
        continue;
      }
      const img = await prepareImage(buf, path, blobType);
      if (typeof img === "string") notes.push(img);
      else images.push(img);
    } else if (kind === "text") {
      parts.push(`[파일 ${name}]\n${buf.toString("utf8").slice(0, 20_000)}`);
    } else {
      notes.push(`지원하지 않는 파일 형식: ${name} (${blobType || "알 수 없음"})`);
    }
  }

  const text = parts.join("\n\n").slice(0, MAX_CHARS);
  if (!text && images.length === 0 && documents.length === 0) {
    throw badRequest(notes.length ? `첨부한 자료를 읽지 못했다: ${notes.join(" / ")}` : "아이디어 설명, 웹사이트, 피치덱, 사진 중 하나는 필요하다");
  }
  return { text: text || "(사진 자료만 있음)", images, documents, notes };
}
