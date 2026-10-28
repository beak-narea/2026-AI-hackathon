import "server-only";
import type { Db } from "../supabase/server";
import { must } from "../api/handler";
import { computeCostModel, CostInputsSchema, type CostInputs } from "../cost/unitEconomics";

export async function priceTable(admin: Db) {
  return must(await admin.from("price_table").select("*").order("model_name"));
}

/** 4번 계산기: 모델 단가표에서 고르면 단가를 채우고, 사용자가 직접 넣은 값이 우선한다 */
export async function recalculate(admin: Db, projectId: string, raw: Partial<CostInputs> & { model_name?: string }) {
  let prices: Partial<CostInputs> = {};
  let updatedAt: string | null = null;
  if (raw.model_name) {
    const row = must(await admin.from("price_table").select("*").eq("model_name", raw.model_name).maybeSingle(), "모델 단가");
    prices = { inputPricePerMTok: Number(row.input_per_mtok_krw), outputPricePerMTok: Number(row.output_per_mtok_krw) };
    updatedAt = row.updated_at;
  }
  const inputs = CostInputsSchema.parse({ ...prices, ...stripUndefined(raw) });
  const results = computeCostModel(inputs);
  const { data: bm } = await admin
    .from("business_models")
    .select("id")
    .eq("project_id", projectId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = must(
    await admin
      .from("cost_models")
      .insert({ project_id: projectId, business_model_id: bm?.id ?? null, inputs, results, price_table_updated_at: updatedAt })
      .select("*")
      .single(),
  );
  return { cost_model: row, results, negative_margin: results.margin < 0 };
}

function stripUndefined<T extends Record<string, unknown>>(o: T): Partial<T> {
  const { model_name: _m, ...rest } = o as Record<string, unknown>;
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Partial<T>;
}
