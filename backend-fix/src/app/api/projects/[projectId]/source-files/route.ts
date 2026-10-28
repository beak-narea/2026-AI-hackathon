import { route, requireEditor, badRequest } from "@/lib/api/handler";

const ALLOWED = ["application/pdf", "image/png", "image/jpeg", "image/webp", "text/plain"];

// 피치덱·사진 업로드 (business_model.extract의 files에 경로를 넘긴다)
export const POST = route<{ projectId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const form = await ctx.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("file 필드가 필요하다");
  if (!ALLOWED.includes(file.type)) throw badRequest("PDF, PNG, JPEG, WEBP, 텍스트만 받는다");
  if (file.size > 20 * 1024 * 1024) throw badRequest("파일은 20MB 이하");
  const safe = file.name.replace(/[^\w.\-가-힣]/g, "_");
  const path = `${ctx.params.projectId}/${Date.now()}-${safe}`;
  const { error } = await ctx.admin.storage.from("source-files").upload(path, file, { contentType: file.type });
  if (error) throw error;
  const kind = file.type === "application/pdf" ? "pdf" : file.type.startsWith("image/") ? "image" : "text";
  const { error: rowError } = await ctx.admin.from("source_files").insert({ project_id: ctx.params.projectId, kind, storage_path: path });
  if (rowError) {
    await ctx.admin.storage.from("source-files").remove([path]);
    throw rowError;
  }
  return { path, kind };
});
