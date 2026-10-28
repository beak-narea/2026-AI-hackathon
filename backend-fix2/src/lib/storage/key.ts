import { randomUUID } from "node:crypto";

// Supabase Storage는 영문·숫자와 일부 기호로 된 경로만 받는다 (한글 파일명은 "Invalid key"로 거절된다).
// 원래 파일명은 DB에 따로 남기고, 저장소 경로는 ASCII로만 만든다.
export const STORAGE_KEY_RE = /^[A-Za-z0-9_/!.*'() &$=@;:+,?-]*$/;

/** 파일명에서 확장자(소문자)만 안전하게 꺼낸다. 없으면 fallback */
export function extensionOf(fileName: string, fallback = "bin"): string {
  const m = fileName.toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return m ? m[1]! : fallback;
}

/** 저장소에 쓸 파일 이름: 시각-무작위[-영문 이름].확장자 */
export function storageFileName(fileName: string, fallbackExt = "bin"): string {
  const ext = extensionOf(fileName, fallbackExt);
  const base = fileName
    .replace(/\.[^.]*$/, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${Date.now()}-${randomUUID().slice(0, 8)}${base ? `-${base}` : ""}.${ext}`;
}
