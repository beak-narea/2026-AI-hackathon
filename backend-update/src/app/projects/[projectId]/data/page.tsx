"use client";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ProjectShell, ReadOnlyHint, useProject } from "@/components/ProjectShell";
import { Stage, TiltCard } from "@/components/Stage";
import { ConnectionStatus } from "@/components/badges";
import { api, dateKo, useAction, useApi } from "@/lib/client/api";
import { Empty, ErrorNote, Field, Note, Segmented, toast } from "@/components/ui";
import { projectName } from "@/lib/client/format";

type Provider = "posthog" | "amplitude" | "langfuse";
interface Conn {
  id: string; tool_name: string; kind: "analytics" | "llm_monitoring"; provider: Provider | "webhook"; status: string;
  config: Record<string, string>; last_sync_at: string | null; last_error: string | null;
}

const FIELDS: Record<Provider, Array<{ key: string; label: string; hint?: string; secret?: boolean; placeholder?: string }>> = {
  posthog: [
    { key: "host", label: "주소", placeholder: "https://us.posthog.com", hint: "EU면 https://eu.posthog.com, 자체 호스팅이면 그 주소" },
    { key: "project_id", label: "프로젝트 ID", hint: "PostHog 프로젝트 설정의 숫자 ID" },
    { key: "api_key", label: "Personal API key", secret: true, hint: "Settings → Personal API keys, 권한은 Query Read만" },
  ],
  amplitude: [
    { key: "region", label: "지역", placeholder: "us", hint: "us 또는 eu" },
    { key: "api_key", label: "API key", secret: true },
    { key: "secret_key", label: "Secret key", secret: true, hint: "Project settings → General" },
  ],
  langfuse: [
    { key: "host", label: "주소", placeholder: "https://cloud.langfuse.com", hint: "US 리전이면 https://us.cloud.langfuse.com" },
    { key: "public_key", label: "Public key", placeholder: "pk-lf-…" },
    { key: "secret_key", label: "Secret key", secret: true, placeholder: "sk-lf-…" },
  ],
};
const LABEL: Record<Provider, string> = { posthog: "PostHog", amplitude: "Amplitude", langfuse: "Langfuse" };

function AddIntegration({ projectId, done }: { projectId: string; done: () => Promise<void> }) {
  const [provider, setProvider] = useState<Provider>("posthog");
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const add = useAction(async () => {
    const config = Object.fromEntries(Object.entries(cfg).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
    const r = await api<{ test: { ok: boolean; error?: string } }>(`/api/projects/${projectId}/integrations`, { body: { provider, config } });
    toast(r.test.ok ? `${LABEL[provider]} 연결을 확인했습니다` : `저장했지만 연결 확인 실패: ${r.test.error}`, !r.test.ok);
    setCfg({});
    await done();
  });
  return (
    <div className="panel panel--tilt">
      <h3>분석·LLM 모니터링 도구 연결</h3>
      <p className="small" style={{ marginTop: 0 }}>키는 암호화해 저장하고 다시 보여주지 않습니다. 읽기 권한만 있는 키를 쓰세요.</p>
      <div className="field">
        <span>도구</span>
        <Segmented label="도구" value={provider} onChange={(v) => { setProvider(v); setCfg({}); }} options={(Object.keys(LABEL) as Provider[]).map((p) => ({ value: p, label: LABEL[p] }))} />
      </div>
      {FIELDS[provider].map((f) => (
        <Field key={f.key} label={f.label} hint={f.hint}>
          <input className="input" type={f.secret ? "password" : "text"} autoComplete="off" placeholder={f.placeholder} value={cfg[f.key] ?? ""} onChange={(e) => setCfg({ ...cfg, [f.key]: e.target.value })} />
        </Field>
      ))}
      <ErrorNote error={add.error} />
      <button className="pill pill--ink" disabled={add.busy} onClick={() => void add.run()}>{add.busy ? "확인하는 중" : "연결하고 확인"}</button>
    </div>
  );
}

function Body({ projectId }: { projectId: string }) {
  const { canEdit } = useProject();
  const { data, reload, error } = useApi<{ connections: Conn[] }>(`/api/projects/${projectId}/data-connections`);
  const [tool, setTool] = useState("");
  const [kind, setKind] = useState<Conn["kind"]>("analytics");
  const [token, setToken] = useState<string | null>(null);
  const [mode, setMode] = useState<"pull" | "push">("pull");
  const addToken = useAction(async () => {
    const r = await api<{ ingest_token: string }>(`/api/projects/${projectId}/data-connections`, { body: { tool_name: tool, kind } });
    setToken(r.ingest_token);
    setTool("");
    await reload();
  });
  const remove = useAction(async (id: string) => {
    await api(`/api/projects/${projectId}/data-connections/${id}`, { method: "DELETE" });
    await reload();
  });
  const test = useAction(async (id: string) => {
    const r = await api<{ ok: boolean; error?: string }>(`/api/projects/${projectId}/data-connections/${id}/test`, { method: "POST" });
    toast(r.ok ? "연결이 정상입니다" : `연결 실패: ${r.error}`, !r.ok);
    await reload();
  });
  const sync = useAction(async (id?: string) => {
    const r = await api<{ results: Array<{ metrics: Array<{ skipped?: string; result?: string }>; cost?: { skipped?: string }; error?: string }> }>(
      `/api/projects/${projectId}/integrations/sync`, { body: id ? { connection_id: id } : {} },
    );
    const measured = r.results.flatMap((x) => x.metrics).filter((m) => m.result).length;
    const errors = r.results.filter((x) => x.error).length;
    toast(errors ? `${errors}개 연결에서 오류` : `가져왔습니다 (지표 ${measured}개 재판정)`, errors > 0);
    await reload();
  });
  const conns = data?.connections ?? [];
  const pulls = conns.filter((c) => c.provider !== "webhook");
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <>
      <ErrorNote error={error ?? remove.error ?? test.error ?? sync.error} />
      <section className="section">
        <div className="section__head">
          <div>
            <h2>연결된 도구</h2>
            <p>고객 행동 분석과 A/B 테스트는 팀의 도구에서 합니다. 여기서는 지표 카드에 정한 값과 실제 AI 비용만 가져옵니다. 매일 한 번 자동으로 가져옵니다.</p>
          </div>
          {canEdit && pulls.length ? <button className="pill" disabled={sync.busy} onClick={() => void sync.run()}>{sync.busy ? "가져오는 중" : "지금 모두 가져오기"}</button> : null}
        </div>
        {conns.length === 0 ? <Empty title="연결된 도구가 없습니다">분석 도구를 연결하면 지표 카드가, LLM 모니터링 도구를 연결하면 비용 비교가 자동으로 갱신됩니다.</Empty> : (
          <div className="rows">
            {conns.map((c) => (
              <div key={c.id} className="row">
                <div>
                  <div className="row__title">{c.tool_name}</div>
                  <div className="row__meta">
                    {c.kind === "analytics" ? "분석 도구" : "LLM 모니터링"}, {c.provider === "webhook" ? "수신 토큰으로 받음" : "서비스가 가져옴"}
                    {c.config?.host ? `, ${c.config.host}` : ""}{c.config?.project_id ? ` #${c.config.project_id}` : ""}
                    , 마지막 {c.last_sync_at ? dateKo(c.last_sync_at) : "없음"}{c.last_error ? `, 오류: ${c.last_error}` : ""}
                  </div>
                </div>
                <div className="row__side">
                  <ConnectionStatus status={c.status} />
                  {canEdit && c.provider !== "webhook" ? (
                    <>
                      <button className="pill pill--sm" disabled={test.busy} onClick={() => void test.run(c.id)}>확인</button>
                      <button className="pill pill--sm" disabled={sync.busy} onClick={() => void sync.run(c.id)}>가져오기</button>
                    </>
                  ) : null}
                  {canEdit ? <button className="pill pill--sm" disabled={remove.busy} onClick={() => void remove.run(c.id)}>끊기</button> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      {canEdit ? (
        <section className="section">
          <div className="section__head">
            <h2>새 연결</h2>
            <Segmented label="연결 방식" value={mode} onChange={setMode} options={[{ value: "pull", label: "API 키로 가져오기" }, { value: "push", label: "도구에서 보내기 (토큰)" }]} />
          </div>
          {mode === "pull" ? <AddIntegration projectId={projectId} done={reload} /> : (
            <div className="panel panel--tilt">
              <h3>수신 토큰</h3>
              <p className="small" style={{ marginTop: 0 }}>다른 도구나 사내 스크립트가 값을 보낼 때 씁니다.</p>
              <Field label="도구 이름"><input className="input" value={tool} onChange={(e) => setTool(e.target.value)} placeholder="예: Mixpanel, 사내 대시보드" /></Field>
              <div className="field">
                <span>종류</span>
                <Segmented label="종류" value={kind} onChange={setKind} options={[{ value: "analytics", label: "분석 도구" }, { value: "llm_monitoring", label: "LLM 모니터링" }]} />
              </div>
              <ErrorNote error={addToken.error} />
              <button className="pill pill--ink" disabled={addToken.busy || !tool} onClick={() => void addToken.run()}>수신 토큰 만들기</button>
              {token ? (
                <div className="sub" style={{ marginTop: 14 }}>
                  <p style={{ margin: "0 0 8px" }}><strong>이 토큰은 지금 한 번만 보입니다.</strong> 도구의 웹훅이나 정기 작업에 넣으세요.</p>
                  <pre className="small" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{`curl -X POST ${origin}/api/ingest \\
  -H "Authorization: Bearer ${token}" \\
  -H "content-type: application/json" \\
  -d '{"type":"metric","event_name":"<지표 카드 이벤트>","successes":12,"n":40,"period_start":"2026-10-01T00:00:00Z","period_end":"2026-10-31T00:00:00Z"}'`}</pre>
                </div>
              ) : null}
            </div>
          )}
          <Note tone="info"><p>지표 카드마다 &ldquo;자동 측정&rdquo; 이벤트(분자·분모)를 출시 후 측정 화면에서 정해야 가져온 값으로 판정합니다.</p></Note>
        </section>
      ) : <ReadOnlyHint />}
    </>
  );
}

export default function DataPage() {
  const { projectId } = useParams<{ projectId: string }>();
  return (
    <ProjectShell projectId={projectId} stage={(info) => (
      <Stage short crumb={<><b>데이터 연결</b>{projectName(info?.project.name)}</>} seed={10}>
        <TiltCard title="팀의 도구에서 결과 받기" sub="분석과 A/B 테스트는 쓰던 도구에서 하고, 값만 가져와 같은 기준으로 다시 판정합니다." />
      </Stage>
    )}>
      <Body projectId={projectId} />
    </ProjectShell>
  );
}
