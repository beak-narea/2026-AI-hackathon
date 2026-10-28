// 검증 실험 및 MVP 기획서 PDF. 한국어 폰트(Noto Sans KR, OFL)를 서버 파일에서 읽는다.
import path from "node:path";
import React from "react";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { LABEL_KO, type EvidenceLevel } from "../domain/rules";

let fontsReady = false;
function registerFonts() {
  if (fontsReady) return;
  const dir = path.join(process.cwd(), "assets", "fonts");
  Font.register({
    family: "NotoSansKR",
    fonts: [
      { src: path.join(dir, "NotoSansKR-Regular.ttf"), fontWeight: 400 },
      { src: path.join(dir, "NotoSansKR-Bold.ttf"), fontWeight: 700 },
    ],
  });
  // 한글은 글자 단위로 줄을 바꾼다
  Font.registerHyphenationCallback((word) => Array.from(word).flatMap((ch) => [ch, ""]).slice(0, -1));
  fontsReady = true;
}

const s = StyleSheet.create({
  page: { fontFamily: "NotoSansKR", fontSize: 10, padding: 40, lineHeight: 1.5, color: "#1a1a1a" },
  title: { fontSize: 18, fontWeight: 700, lineHeight: 1.3, marginBottom: 6 },
  meta: { fontSize: 9, color: "#666", marginBottom: 16 },
  h2: { fontSize: 12, fontWeight: 700, marginTop: 14, marginBottom: 6 },
  box: { borderWidth: 1, borderColor: "#ccc", borderRadius: 4, padding: 8, marginBottom: 6 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#ddd" },
  cell: { flex: 1, padding: 4 },
  head: { fontWeight: 700, backgroundColor: "#f0efec" },
  li: { marginBottom: 3 },
  note: { fontSize: 8.5, color: "#555" },
  banner: { backgroundColor: "#f9eeda", padding: 6, marginBottom: 10, fontSize: 9 },
});

export interface ProposalPdfData {
  projectName: string;
  isExample: boolean;
  hypothesis: string;
  proposal: {
    id: string;
    method: string;
    evidence_level_expected: EvidenceLevel;
    guide_steps: string[];
    prerequisites: string[];
    mvp_scope: string;
    recruitment: string;
    script: string;
    operating_rules: string[];
    target_value: number;
    min_value: number;
    locked_at: string | null;
    expected_rate: number | null;
    sample_size: number | null;
    conclusion_probability: number | null;
    decision_table: Array<{ n: number; metFrom: number | null; holdFrom: number | null; holdTo: number | null; failTo: number | null }>;
    expected_weeks: number | null;
    look_number: number;
  };
  resultFormUrl: string;
}

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "-" : `${Math.round(Number(v) * 1000) / 10}%`);
const range = (a: number | null, b: number | null, suffix: string) =>
  a === null ? "-" : b === null ? `${a}${suffix} 이상` : a === b ? `${a}${suffix}` : `${a}~${b}${suffix}`;

function ProposalDoc({ d }: { d: ProposalPdfData }) {
  const p = d.proposal;
  return (
    <Document title={`검증 실험 및 MVP 기획서 - ${d.projectName}`} language="ko">
      <Page size="A4" style={s.page}>
        {d.isExample ? <Text style={s.banner}>예시 · 가상 사례</Text> : null}
        <Text style={s.title}>검증 실험 및 MVP 기획서</Text>
        <Text style={s.meta}>
          {d.projectName} · 제안 번호 {p.id.slice(0, 8)} · {p.look_number > 1 ? `재판정 ${p.look_number}회차 · ` : ""}
          {p.locked_at ? `기준 잠금 ${p.locked_at.slice(0, 10)}` : "기준 잠금 전 (초안)"}
        </Text>

        <Text style={s.h2}>1. 검증할 가설과 기준</Text>
        <View style={s.box}>
          <Text>{d.hypothesis}</Text>
          <Text style={{ marginTop: 4 }}>
            목표값 {pct(p.target_value)} · 최소 허용치 {pct(p.min_value)} · 증거 수준 {p.evidence_level_expected}(
            {LABEL_KO.evidence[p.evidence_level_expected]})
          </Text>
          <Text style={s.note}>목표값은 사업 계획이 성립하는 값, 최소 허용치는 그보다 낮으면 사업 모델을 바꿔야 하는 값이다. 결과를 본 뒤에는 바꿀 수 없다.</Text>
        </View>

        <Text style={s.h2}>2. 실험 방법과 실행 가이드</Text>
        <Text style={{ fontWeight: 700 }}>{p.method}</Text>
        {p.prerequisites.length ? <Text>준비물: {p.prerequisites.join(", ")}</Text> : null}
        <Text>대상 모집: {p.recruitment}</Text>
        {p.guide_steps.map((step, i) => (
          <Text key={i} style={s.li}>
            {i + 1}. {step}
          </Text>
        ))}
        <Text style={{ fontWeight: 700, marginTop: 6 }}>스크립트·질문지</Text>
        <Text>{p.script}</Text>
        <Text style={{ fontWeight: 700, marginTop: 6 }}>운영 수칙</Text>
        {p.operating_rules.map((r, i) => (
          <Text key={i} style={s.li}>
            · {r}
          </Text>
        ))}

        <Text style={s.h2}>3. 검증용 MVP 범위</Text>
        <Text>{p.mvp_scope}</Text>

        <Text style={s.h2}>4. 필요 표본 수와 결정표</Text>
        <Text>
          필요 표본 {p.sample_size ?? "-"}명 · 예상 실제 값 {pct(p.expected_rate)}일 때 결론(충족 또는 미달)이 나올 확률{" "}
          {pct(p.conclusion_probability)}
        </Text>
        <View style={{ marginTop: 6 }}>
          <View style={[s.row, s.head]}>
            <Text style={s.cell}>표본 수</Text>
            <Text style={s.cell}>충족</Text>
            <Text style={s.cell}>판정 보류</Text>
            <Text style={s.cell}>미달</Text>
          </View>
          {p.decision_table.map((r) => (
            <View key={r.n} style={s.row}>
              <Text style={s.cell}>{r.n}명</Text>
              <Text style={s.cell}>{r.metFrom === null ? "불가" : `${r.metFrom}명 이상`}</Text>
              <Text style={s.cell}>{range(r.holdFrom, r.holdTo, "명")}</Text>
              <Text style={s.cell}>{r.failTo === null ? "불가" : `${r.failTo}명 이하`}</Text>
            </View>
          ))}
        </View>
        <Text style={s.note}>
          판정 규칙: Jeffreys 사전분포로 실제 비율이 목표값을 넘을 확률이 80% 이상이면 충족, 최소 허용치에 못 미칠 확률이 80% 이상이면 미달,
          둘 다 아니면 판정 보류. 같은 회사의 여러 명은 묶음으로 센다.
        </Text>

        <Text style={s.h2}>5. 결과 제출</Text>
        <Text>결과는 결과 제출 폼으로만 받는다: {d.resultFormUrl}</Text>
        <Text style={s.note}>
          폼 항목: 실제로 쓴 방법, 대상 모집 방법, 시도 수·응답 수·성공 수, 원자료(CSV·전사본·사용 기록), 지인·기존 고객 비율, 같은 회사 응답자 수, 운영 수칙 준수, 메모.
        </Text>

        <Text style={s.h2}>6. 예상 기간</Text>
        <Text>{p.expected_weeks ?? 2}주 이내</Text>
      </Page>
    </Document>
  );
}

export async function renderProposalPdf(data: ProposalPdfData): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<ProposalDoc d={data} />);
}
