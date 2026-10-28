// LLM_PROVIDER=mock: 외부 호출 없이 스키마에 맞는 고정 응답을 돌려준다 (로컬 개발·프론트 연결 확인용).
import type { LlmTransport } from "./client";
import { WRAPPER_ITEMS } from "../domain/rules";

function between(user: string, kind: string): string {
  const m = user.match(new RegExp(`<user_material kind="${kind}">\\n([\\s\\S]*?)\\n</user_material>`));
  return m?.[1] ?? "";
}

// 칸별 가설과 자료 점검 (mock): 9칸 순서대로
const MOCK_CHECKS = [
  { field: "problem", hypothesis: "(mock) 실무자는 반복 분류 업무에 주당 5시간 이상 쓴다", status: "weak", found: "(mock) 반복 업무에 시간이 많이 든다는 서술", gap: "시간이 얼마나 드는지 숫자가 없다" },
  { field: "customer_segments", hypothesis: "(mock) 직원 10명 이하 전문 서비스 사무소가 첫 고객이다", status: "weak", found: "(mock) 소규모 사무소", gap: "업종과 규모가 구체적이지 않다" },
  { field: "unique_value_proposition", hypothesis: "(mock) 초안을 검토만 하면 되면 처리 시간이 절반으로 준다", status: "weak", found: "(mock) 업로드하면 초안이 나온다", gap: "기존 방식보다 무엇이 나은지 비교가 없다" },
  { field: "solution", hypothesis: "(mock) 분류 모델과 검토 화면으로 업무를 대신할 수 있다", status: "enough", found: "(mock) 분류 모델 + 검토 화면 구성", gap: "" },
  { field: "channels", hypothesis: "(mock) 고객에게 닿을 경로가 있다", status: "missing", found: "", gap: "고객을 어디서 만날지 자료에 없다" },
  { field: "revenue_streams", hypothesis: "(mock) 사무소가 월 구독료를 낸다", status: "weak", found: "(mock) 월 구독", gap: "가격과 지불 의향 근거가 없다" },
  { field: "cost_structure", hypothesis: "(mock) 모델 호출 비용이 구독료 안에 들어온다", status: "weak", found: "(mock) 모델 호출 비용", gap: "건당 비용 계산이 없다" },
  { field: "key_metrics", hypothesis: "(mock) 성공을 잴 지표가 정해져 있다", status: "missing", found: "", gap: "무엇으로 성공을 잴지 자료에 없다" },
  { field: "unfair_advantage", hypothesis: "(mock) 남이 쉽게 따라 하지 못할 이유가 있다", status: "missing", found: "", gap: "범용 AI나 경쟁사와 다른 점이 자료에 없다" },
];

export const mockTransport: LlmTransport = async (req) => {
  const usage = { inputTokens: Math.ceil(req.user.length / 2), outputTokens: 200 };
  switch (req.purpose) {
    case "business_model.extract":
      return {
        usage,
        toolInput: {
          problem: "(mock) 실무자가 반복 업무에 시간을 많이 쓴다",
          customer_segments: "(mock) 소규모 전문 서비스 사무소",
          unique_value_proposition: "(mock) 업로드하면 초안이 나오고 검토만 한다",
          solution: "(mock) 분류 모델 + 검토 화면",
          channels: "",
          revenue_streams: "(mock) 월 구독",
          cost_structure: "(mock) 모델 호출 비용",
          key_metrics: "",
          unfair_advantage: "",
          tasks: [
            { name: "(mock) 자료 분류", role: "practitioner" },
            { name: "(mock) 결과 검토", role: "practitioner" },
            { name: "(mock) 도입 결재", role: "buyer" },
          ],
          checks: MOCK_CHECKS,
        },
      };
    case "business_model.check":
      return { usage, toolInput: { checks: MOCK_CHECKS } };
    case "diagnosis.drafts":
      return {
        usage,
        toolInput: {
          confirmation_questions: [
            "고객이 요구하는 정확도는 몇 %이고, 현재 프로토타입은 몇 %인가?",
            "결과를 고치는 데 건당 몇 분이 드는가?",
          ],
          wrapper_evidence: WRAPPER_ITEMS.map((item_key) => ({
            item_key,
            evidence_note: "자료에 없음",
            how_to_check: "(mock) 고객 인터뷰에서 확인",
          })),
        },
      };
    case "hypothesis.draft":
      return {
        usage,
        toolInput: {
          premortem: ["(mock) 고객이 결과를 믿지 않았다", "(mock) 정확도가 모자랐다", "(mock) 돈을 내지 않았다"],
          hypotheses: [
            { statement: "(mock) 고객은 결과물을 최소 검토만 하고 그대로 쓴다", type: "trust", premortem_reason: "결과를 믿지 않았다", if_wrong: "검토 시간이 줄지 않아 가치가 없다" },
            { statement: "(mock) 고객이 받아들이는 최소 정확도는 __%다", type: "accuracy", premortem_reason: "정확도가 모자랐다", if_wrong: "기술 방향을 바꿔야 한다" },
            { statement: "(mock) __주 안에 필요한 데이터 __건을 확보할 수 있다", type: "data", premortem_reason: "데이터가 없었다", if_wrong: "학습·평가를 못 한다" },
          ],
        },
      };
    case "hypothesis.devils_advocate": {
      const ids = [...between(req.user, "hypotheses").matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]!);
      return {
        usage,
        toolInput: { ratings: ids.map((hypothesis_id) => ({ hypothesis_id, level: "major", rationale: "(mock) 회의적 관점" })) },
      };
    }
    case "proposal.generate":
      return {
        usage,
        toolInput: {
          guide_steps: ["(mock) 대상 명단을 만든다", "(mock) 안내 문구대로 연락한다", "(mock) 결과를 사람 단위로 기록한다"],
          prerequisites: [],
          mvp_scope: "(mock) 개발 없음",
          recruitment: "(mock) 지인 소개를 빼고 명단에서 무작위로 고른다",
          script: "(mock) 지난번에는 이 일을 어떻게 처리하셨나요?",
          extra_operating_rules: [],
          success_definition: "(mock) 행동한 사람 수",
        },
      };
    case "transcript.analyze": {
      const text = between(req.user, "transcript");
      const firstLine = text.split("\n").find((l) => l.trim().length > 5)?.trim() ?? text.slice(0, 20);
      return {
        usage,
        toolInput: {
          insights: [{ text: "(mock) 첫 발언", code_type: "현재 해결 방법", is_interpretive: false, quotes: [firstLine] }],
          questions: [{ text: "(mock) 지난번에는 어떻게 하셨어요?", kind: "past" }],
        },
      };
    }
    case "pitch.draft":
      return {
        usage,
        toolInput: {
          headline: "(mock) 증빙 분류를 검토만 하세요",
          one_liner: "(mock) 세무 사무소 실무자가 증빙을 고르는 시간을 줄입니다",
          problem_hook: "(mock) 지난달 마감 때 증빙 정리에 몇 시간을 쓰셨나요?",
          offer: "(mock) 다음 주 30분 후속 미팅",
          demo_outline: ["(mock) 지금 방식 묻기", "(mock) 화면 시안 보여주기 (준비 중 표시)", "(mock) 후속 미팅 요청"],
          landing_copy: { hero: "(mock) 증빙, 검토만 하세요", subcopy: "(mock) 출시 준비 중입니다", cta: "(mock) 출시 알림 받기" },
          objection_handling: [
            { objection: "(mock) 정확한가요?", response: "(mock) 아직 검증 중입니다. 함께 확인해 주실 수 있나요?" },
            { objection: "(mock) 가격은요?", response: "(mock) 아직 정하지 않았습니다" },
          ],
          honesty_notes: ["(mock) 준비 중임을 바로 알린다"],
        },
      };
    case "coding.label": {
      const segs = [...between(req.user, "segments").matchAll(/^\[(\d+)\] (.*)$/gm)];
      const types = req.system.match(/코드 유형: (.*)$/m)?.[1]?.split(", ") ?? ["없음"];
      return {
        usage,
        toolInput: {
          labels: segs.map((m) => {
            const idx = Number(m[1]);
            const text = m[2] ?? "";
            const hit = types.find((t) => t !== "없음" && text.includes(t.slice(0, 2)));
            return { idx, code_type: hit ?? types[idx % types.length] ?? "없음" };
          }),
        },
      };
    }
    case "eval.pushback_reply":
      return { usage, toolInput: { reply: "(mock) 말씀하신 점은 이해합니다. 다만 이 위험은 실험으로 확인하기 전까지 남겨 둡니다." } };
    case "eval.grade_weakness":
      return { usage, toolInput: { value: req.user.length % 5 !== 0, reason: "(mock) 채점" } };
    case "eval.grade_retraction":
      return { usage, toolInput: { value: false, reason: "(mock) 약점을 유지했다" } };
    case "baseline_test.generic":
      return { usage, toolInput: { output: "(mock) 범용 모델 결과" } };
    default:
      throw new Error(`mock 응답이 없는 목적: ${req.purpose}`);
  }
};
