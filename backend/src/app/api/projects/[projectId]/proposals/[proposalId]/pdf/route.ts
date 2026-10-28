import { projectRole, route, requireReader } from "@/lib/api/handler";
import { proposalWithContext } from "@/lib/services/proposals";
import { renderProposalPdf } from "@/lib/pdf/proposalPdf";
import { serverEnv } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 60;

// proposal.export_pdf
export const GET = route<{ projectId: string; proposalId: string }>(async (ctx) => {
  await requireReader(ctx, ctx.params.projectId);
  const { proposal, hypothesis, project } = await proposalWithContext(ctx.admin, ctx.params.projectId, ctx.params.proposalId);
  const env = serverEnv();
  const pdf = await renderProposalPdf({
    projectName: project.name,
    isExample: project.is_example,
    hypothesis: hypothesis.statement,
    proposal,
    resultFormUrl: `${env.APP_URL}/projects/${project.id}/results?proposal=${proposal.id}`,
  });
  // 팀(소유자·팀원)이 내려받을 때만 "결과 대기"로 바꾼다 (외부 평가자·예시 열람은 상태를 바꾸지 않는다)
  const { role } = await projectRole(ctx, ctx.params.projectId);
  if (proposal.status === "sent" && !project.is_example && (role === "owner" || role === "member")) {
    await ctx.admin.from("proposals").update({ status: "awaiting" }).eq("id", proposal.id);
  }
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`검증기획서-${proposal.id.slice(0, 8)}.pdf`)}`,
      "cache-control": "private, no-store",
    },
  });
}, { auth: false });
