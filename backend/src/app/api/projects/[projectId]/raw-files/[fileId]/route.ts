import { route, requireEditor } from "@/lib/api/handler";
import { deleteRawFile, downloadRawFile } from "@/lib/services/rawFiles";

type P = { projectId: string; fileId: string };

// 내려받기
export const GET = route<P>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId); // 원자료는 팀(소유자·팀원)만
  const { blob, name } = await downloadRawFile(ctx.admin, ctx.params.projectId, ctx.params.fileId);
  return new Response(blob, {
    headers: {
      "content-type": blob.type || "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "no-store",
    },
  });
});

// 원자료 삭제 (판정에 쓴 숫자는 남는다)
export const DELETE = route<P>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  return deleteRawFile(ctx.admin, ctx.params.projectId, ctx.params.fileId);
});
