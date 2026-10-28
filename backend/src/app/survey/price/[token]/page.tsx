"use client";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Stage, TiltCard } from "@/components/Stage";
import { api, useAction, useApi } from "@/lib/client/api";
import { ErrorNote, Field, Loading, Note } from "@/components/ui";

const Q: Array<[key: "too_cheap" | "cheap" | "expensive" | "too_expensive", label: string]> = [
  ["too_cheap", "어느 가격부터 너무 싸서 품질이 의심스러운가요?"],
  ["cheap", "어느 가격이면 싸다(가성비가 좋다)고 느끼나요?"],
  ["expensive", "어느 가격부터 비싸다고 느끼지만 그래도 고려는 하나요?"],
  ["too_expensive", "어느 가격부터 너무 비싸서 사지 않나요?"],
];

export default function PriceSurvey() {
  const { token } = useParams<{ token: string }>();
  const { data, loading, error } = useApi<{ title: string; description: string; open: boolean }>(`/api/survey/price/${token}`);
  const [who, setWho] = useState("");
  const [v, setV] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const num = (k: string) => Number(String(v[k] ?? "").replace(/[^0-9]/g, ""));
  const submit = useAction(async () => {
    await api(`/api/survey/price/${token}`, {
      body: { respondent: who, too_cheap: num("too_cheap"), cheap: num("cheap"), expensive: num("expensive"), too_expensive: num("too_expensive") },
    });
    setDone(true);
  });
  const ordered = num("too_cheap") <= num("cheap") && num("cheap") <= num("expensive") && num("expensive") <= num("too_expensive");
  const filled = Q.every(([k]) => v[k]);
  return (
    <>
      <Stage short crumb={<b>가격 설문</b>}>
        <TiltCard title={data?.title ?? "가격 설문"} sub={data?.description || "검증 프로그램(8주) 한 번의 가격을 어떻게 느끼는지 묻습니다. 답은 가격 범위를 정하는 데만 씁니다."} />
      </Stage>
      <div className="work work--wide">
        <main id="main" style={{ maxWidth: 720 }}>
          {loading ? <Loading /> : error ? <ErrorNote error={error} /> : done ? (
            <Note tone="good"><p><strong>답해 주셔서 감사합니다.</strong> 이 창은 닫아도 됩니다.</p></Note>
          ) : !data?.open ? (
            <Note tone="warn"><p>마감된 설문입니다.</p></Note>
          ) : (
            <div className="panel">
              <Field label="팀 이름 또는 이메일" hint="같은 사람이 두 번 답하지 않도록 확인하는 데만 씁니다">
                <input className="input" value={who} onChange={(e) => setWho(e.target.value)} />
              </Field>
              {Q.map(([k, label]) => (
                <Field key={k} label={label} hint="원 단위, 숫자만">
                  <input className="input num" inputMode="numeric" value={v[k] ?? ""} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
                </Field>
              ))}
              {filled && !ordered ? <Note tone="warn"><p>너무 싸다 ≤ 싸다 ≤ 비싸다 ≤ 너무 비싸다 순서가 되도록 적어 주세요.</p></Note> : null}
              <ErrorNote error={submit.error} />
              <button className="pill pill--ink" disabled={submit.busy || !filled || !ordered || who.trim().length < 2} onClick={() => void submit.run()}>보내기</button>
            </div>
          )}
        </main>
      </div>
    </>
  );
}
