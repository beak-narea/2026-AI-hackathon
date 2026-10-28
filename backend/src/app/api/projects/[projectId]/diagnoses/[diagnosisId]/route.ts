import { z } from "zod";
import { route, body, requireEditor } from "@/lib/api/handler";
import { updateDiagnosis } from "@/lib/services/diagnosis";
import { EVIDENCE_LEVELS, WRAPPER_ITEMS } from "@/lib/domain/rules";

const Agency = z.enum(["H1", "H2", "H3", "H4", "H5"]).nullable();
const Axis = z.object({ verdict: z.enum(["met", "not_met", "on_hold", "no_conclusion"]).nullable(), level: z.enum(EVIDENCE_LEVELS) });

// diagnosis.update_task
export const PATCH = route<{ projectId: string; diagnosisId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const input = await body(
    ctx.req,
    z.object({
      agency_assumed: Agency.optional(),
      agency_observed: Agency.optional(),
      wrapper_items: z
        .array(
          z.object({
            item_key: z.enum(WRAPPER_ITEMS),
            status: z.enum(["yes", "no", "unknown"]),
            evidence_note: z.string().max(4000).optional(),
            evidence_url: z.string().url().max(2000).refine((u) => /^https?:\/\//i.test(u), "http 또는 https 주소만").nullable().optional(),
          }),
        )
        .optional(),
      feasibility: Axis.optional(),
      demand: Axis.optional(),
      buyer_demand: Axis.optional(),
      demand_prior: z.number().nullable().optional(),
      demand_prior_task: z.string().nullable().optional(),
    }),
  );
  return updateDiagnosis(ctx.admin, ctx.params.projectId, ctx.params.diagnosisId, input);
});
