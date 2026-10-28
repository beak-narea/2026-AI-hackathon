"use client";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Stage, TiltCard } from "@/components/Stage";
import { Ring } from "@/components/Ring";
import { api, useAction, useApi } from "@/lib/client/api";
import { ErrorNote, Field, Loading, Note } from "@/components/ui";

interface Pair { id: string; input_text: string; output_a: string; output_b: string }

export default function Evaluate() {
  const { token } = useParams<{ token: string }>();
  const { data, loading, error } = useApi<{ instruction: string; pairs: Pair[] }>(`/api/baseline/${token}`);
  const [who, setWho] = useState("");
  const [picks, setPicks] = useState<Record<string, boolean>>({});
  const [done, setDone] = useState(false);
  const pairs = data?.pairs ?? [];
  const count = Object.keys(picks).length;
  const submit = useAction(async () => {
    await api(`/api/baseline/${token}/votes`, { body: { evaluator: who, votes: Object.entries(picks).map(([pair_id, chose_a]) => ({ pair_id, chose_a })) } });
    setDone(true);
  });
  return (
    <>
      <Stage short crumb={<b>결과 비교 평가</b>}>
        <TiltCard title="어느 쪽 결과가 더 낫나요?" sub="같은 입력에 대한 두 결과입니다. 어느 쪽이 누구의 것인지는 알려 드리지 않습니다. 업무에 그대로 쓰고 싶은 쪽을 고르세요.">
          <Ring value={count} max={Math.max(pairs.length, 1)} display={String(count)} unit={`/${pairs.length}`} label="고른 항목" tone="teal" />
        </TiltCard>
      </Stage>
      <div className="work work--wide">
        <main id="main" style={{ maxWidth: 900 }}>
          {loading ? <Loading /> : error ? <ErrorNote error={error} /> : done ? (
            <Note tone="good"><p><strong>평가를 보냈습니다. 감사합니다.</strong> 이 창은 닫아도 됩니다.</p></Note>
          ) : (
            <>
              <p className="muted">작업: {data?.instruction}</p>
              {pairs.map((p, i) => (
                <section key={p.id} className="panel" style={{ marginBottom: 16 }}>
                  <h3>{i + 1}번 입력</h3>
                  <p className="small" style={{ whiteSpace: "pre-wrap", marginTop: 0 }}>{p.input_text}</p>
                  <div className="pair">
                    <button type="button" aria-pressed={picks[p.id] === true} onClick={() => setPicks({ ...picks, [p.id]: true })}><b>결과 가</b>{p.output_a}</button>
                    <button type="button" aria-pressed={picks[p.id] === false} onClick={() => setPicks({ ...picks, [p.id]: false })}><b>결과 나</b>{p.output_b}</button>
                  </div>
                </section>
              ))}
              <div className="sub" style={{ border: "1.5px solid rgba(255,255,255,.6)" }}>
                <Field label="평가자 별칭" hint="실명 대신 구분용 별칭을 적으세요. 한 사람은 한 번만 평가합니다.">
                  <input className="input" value={who} maxLength={40} onChange={(e) => setWho(e.target.value)} />
                </Field>
                <ErrorNote error={submit.error} />
                <button className="pill pill--ink" disabled={submit.busy || !who || count < pairs.length} onClick={() => void submit.run()}>
                  {count < pairs.length ? `${pairs.length - count}개 더 고르세요` : "평가 보내기"}
                </button>
              </div>
            </>
          )}
        </main>
      </div>
    </>
  );
}
