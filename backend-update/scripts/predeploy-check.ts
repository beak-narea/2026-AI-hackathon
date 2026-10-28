// 배포 전 점검: 지금 프롬프트·모델 지문으로 아첨 점검 3종이 모두 통과했는지 확인한다. 하나라도 못 넘으면 배포하지 않는다.
//   npm run predeploy:check   (CI에서 배포 단계 앞에 둔다)
import "./_env";
import { createClient } from "@supabase/supabase-js";
import { gateStatus } from "../src/lib/eval/sycophancy";

async function main() {
  const env = process.env;
  if (env.SKIP_SYCOPHANCY_GATE === "1") {
    console.log("△ SKIP_SYCOPHANCY_GATE=1: 아첨 점검을 건너뛴다 (출시 전에는 쓰지 않는다)");
    return;
  }
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const gate = await gateStatus(db, env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5");
  console.log(`아첨 점검 (모델 ${gate.model}, 지문 ${gate.versions_hash})`);
  for (const k of gate.kinds) console.log(`${k.passed ? "✓" : "✗"} ${k.kind}${k.reasons.length ? `: ${k.reasons.join(" / ")}` : ""}`);
  if (!gate.passed) {
    console.error("\n✗ 배포 중단: npm run eval:sycophancy 로 다시 돌리고 운영자 화면에서 채점기 라벨을 채운다.");
    process.exit(1);
  }
  console.log("\n✓ 배포 가능");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
