import { route, requireEditor, badRequest } from "@/lib/api/handler";
import { uploadRawFile } from "@/lib/services/evidence";

// evidence.upload_raw: multipart (file, names?, companies?) → 가명 처리 후 저장. 돌려준 path를 결과 제출 폼의 raw_files에 넣는다.
export const POST = route<{ projectId: string; proposalId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const form = await ctx.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("file 필드가 필요하다");
  const list = (k: string) =>
    String(form.get(k) ?? "")
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  return uploadRawFile(ctx.admin, ctx.params.projectId, ctx.params.proposalId, file, { names: list("names"), companies: list("companies") }, ctx.user.id);
});
