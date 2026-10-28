import { route, requireReader } from "@/lib/api/handler";
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
  if (proposal.status === "sent" && !project.is_example) {
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
