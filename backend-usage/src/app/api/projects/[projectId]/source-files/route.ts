import { route, requireEditor, badRequest } from "@/lib/api/handler";
import { extensionOf, storageFileName } from "@/lib/storage/key";

const ALLOWED = ["application/pdf", "image/png", "image/jpeg", "image/webp", "text/plain"];
const BY_EXT: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", txt: "text/plain", md: "text/plain" };

// 피치덱·사진 업로드 (business_model.extract의 files에 경로를 넘긴다)
export const POST = route<{ projectId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const form = await ctx.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("file 필드가 필요하다");
  // 브라우저가 형식을 비워 보내는 경우(Windows에서 PDF 연결 프로그램이 없을 때 등)는 확장자로 정한다
  const type = ALLOWED.includes(file.type) ? file.type : (BY_EXT[extensionOf(file.name, "")] ?? file.type);
  if (!ALLOWED.includes(type)) throw badRequest(`PDF, PNG, JPEG, WEBP, 텍스트만 받는다 (${file.name})`);
  if (file.size > 20 * 1024 * 1024) throw badRequest(`파일은 20MB 이하 (${file.name})`);
  const fallback = type === "application/pdf" ? "pdf" : type === "text/plain" ? "txt" : (type.split("/")[1] ?? "bin");
  const path = `${ctx.params.projectId}/${storageFileName(file.name, fallback)}`;
  const bytes = new Blob([await file.arrayBuffer()], { type });
  const { error } = await ctx.admin.storage.from("source-files").upload(path, bytes, { contentType: type });
  if (error) throw error;
  const kind = type === "application/pdf" ? "pdf" : type.startsWith("image/") ? "image" : "text";
  const { error: rowError } = await ctx.admin.from("source_files").insert({ project_id: ctx.params.projectId, kind, storage_path: path });
  if (rowError) {
    await ctx.admin.storage.from("source-files").remove([path]);
    throw rowError;
  }
  return { path, kind };
});
