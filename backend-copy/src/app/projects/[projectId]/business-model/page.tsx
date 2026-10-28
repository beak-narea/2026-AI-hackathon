"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ProjectShell, ReadOnlyHint, useProject } from "@/components/ProjectShell";
import { Stage, TiltCard } from "@/components/Stage";
import { api, useAction, useApi, dateKo, emitChange, useOnChange } from "@/lib/client/api";
import { Empty, ErrorNote, Field, Loading, toast } from "@/components/ui";
import { firstSentence, projectName } from "@/lib/client/format";
import { LEVEL_HINT, LevelChip, type Level } from "@/components/levels";

interface Check { field: string; hypothesis: string; status: Level; found: string; gap: string; stale?: boolean }

const FIELDS: Array<[string, string, string]> = [
  ["problem", "문제", "c-problem"],
  ["solution", "해결책", "c-solution"],
  ["key_metrics", "핵심 지표", "c-metrics"],
  ["unique_value_proposition", "가치 제안", "c-uvp"],
  ["unfair_advantage", "경쟁 우위", "c-advantage"],
  ["channels", "채널", "c-channels"],
  ["customer_segments", "고객", "c-segments"],
  ["cost_structure", "비용 구조", "c-cost"],
  ["revenue_streams", "수익", "c-revenue"],
];

interface Task { id: string; name: string; role: "practitioner" | "buyer"; position: number }
type BM = Record<string, string> & { id: string; version: number; variant_label: string | null; created_at: string; extracted_by_llm: boolean; tasks: Task[]; checks?: Check[] };

/** 저장된 점검이 없는 예전 버전: 빈 칸만 없음으로 표시하고, 나머지는 다시 점검을 권한다 */
function checksOf(bm: BM): { checks: Check[]; complete: boolean } {
  const saved = Array.isArray(bm.checks) ? bm.checks : [];
  const by = new Map(saved.map((c) => [c.field, c]));
  const complete = FIELDS.every(([k]) => by.has(k));
  // Lean Canvas를 채우는 순서 (문제 → 고객 → 가치 제안 → 해결책 → 채널 → 수익 → 비용 → 지표 → 경쟁 우위)
  const order = ["problem", "customer_segments", "unique_value_proposition", "solution", "channels", "revenue_streams", "cost_structure", "key_metrics", "unfair_advantage"];
  const checks = order.map((k) => by.get(k) ?? {
    field: k, hypothesis: "", status: (bm[k] ? "weak" : "missing") as Level, found: "", gap: bm[k] ? "아직 점검하지 않았다" : "비어 있다", stale: !!bm[k],
  });
  return { checks, complete };
}

function Body({ projectId }: { projectId: string }) {
  const { canEdit } = useProject();
  const { data, loading, error, reload: reloadOwn } = useApi<{ versions: BM[] }>(`/api/projects/${projectId}/business-models`);
  const reload = useCallback(async () => {
    await reloadOwn();
    emitChange("business-models");
  }, [reloadOwn]);
  const versions = data?.versions ?? [];
  const [sel, setSel] = useState<number | null>(null);
  const bm = versions.find((v) => v.version === sel) ?? versions[0];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [label, setLabel] = useState("");
  const [cmp, setCmp] = useState<number | null>(null);
  const [idea, setIdea] = useState("");
  const [filter, setFilter] = useState<Level | "all">("all");
  const [tasks, setTasks] = useState<Array<{ name: string; role: "practitioner" | "buyer" }>>([]);

  useEffect(() => {
    // 고치는 중에는 다른 곳의 변경으로 입력값이 덮이지 않게
    if (bm && !editing) {
      setDraft(Object.fromEntries(FIELDS.map(([k]) => [k, bm[k] ?? ""])));
      setTasks([...bm.tasks].sort((a, b) => a.position - b.position).map((t) => ({ name: t.name, role: t.role })));
    }
  }, [bm, editing]);
  // 칸에서 나온 가설은 가설 화면과 같은 문장을 보여 준다 (어느 쪽에서 고쳐도 같게)
  const hyps = useApi<{ hypotheses: Array<{ id: string; statement: string; source_field?: string | null; status: string }> }>(`/api/projects/${projectId}/hypotheses`);
  const linked = new Map((hyps.data?.hypotheses ?? []).filter((h) => h.source_field).map((h) => [h.source_field as string, h]));

  const save = useAction(async () => {
    const short = tasks.filter((t) => t.name.trim().length > 0 && t.name.trim().length < 2);
    if (short.length) throw new Error(`업무 이름은 두 글자 이상으로 적습니다: ${short.map((t) => t.name).join(", ")}`);
    const v = await api<BM>(`/api/projects/${projectId}/business-models`, {
      body: {
        ...draft,
        parent_version: bm?.version,
        variant_label: label || undefined,
        tasks: tasks.filter((t) => t.name.trim().length >= 2).map((t) => ({ name: t.name.trim(), role: t.role })),
      },
    });
    toast(`버전 ${v.version}으로 저장했습니다`);
    setEditing(false);
    setSel(v.version);
    await reload();
    // 고친 칸이 있으면 바로 다시 점검해 가설 문장과 단계를 맞춘다
    const stale = (v.checks ?? []).some((c) => c.stale);
    if (stale) void recheckVersion(v.version);
  });
  const extract = useAction(async () => {
    await api(`/api/projects/${projectId}/business-models/extract`, { body: { text: idea } });
    setSel(null);
    await reload();
  });
  const recheck = useAction(async (version?: number) => {
    const v = version ?? bm?.version;
    if (!v) return;
    await api(`/api/projects/${projectId}/business-models/check`, { body: { version: v } });
    toast("칸별 가설을 다시 점검했습니다. 가설 화면에도 반영했습니다");
    await reload();
  });
  const recheckVersion = (v: number) => recheck.run(v);
  const diff = useApi<{ changes: Array<{ field: string; a: string; b: string }> }>(
    cmp && bm && cmp !== bm.version ? `/api/projects/${projectId}/business-models/compare?a=${cmp}&b=${bm.version}` : null,
  );

  if (loading) return <Loading lines={6} />;
  if (error) return <ErrorNote error={error} />;

  if (!bm) {
    return (
      <section className="section">
        <Empty title="아직 사업 모델이 없습니다" />
        {canEdit ? (
          <div style={{ marginTop: 16 }}>
            <Field label="아이디어 설명"><textarea className="textarea" value={idea} onChange={(e) => setIdea(e.target.value)} /></Field>
            <ErrorNote error={extract.error} />
            <button className="pill pill--ink" disabled={extract.busy || idea.length < 10} onClick={() => void extract.run()}>
              {extract.busy ? "정리하는 중" : "사업 모델 정리"}
            </button>
          </div>
        ) : <ReadOnlyHint />}
      </section>
    );
  }

  const { checks, complete } = checksOf(bm);
  const count = (l: Level) => checks.filter((c) => c.status === l).length;
  const shown = filter === "all" ? checks : checks.filter((c) => c.status === filter);
  const needsRecheck = !complete || checks.some((c) => c.stale);
  const fieldName = (k: string) => FIELDS.find(([f]) => f === k)?.[1] ?? k;

  return (
    <>
      <section className="section">
        <div className="section__head">
          <div>
            <h2>가설별 자료 점검</h2>
          </div>
          {canEdit && needsRecheck ? (
            <button className="pill" disabled={recheck.busy} onClick={() => void recheck.run(undefined)}>{recheck.busy ? "점검하는 중" : "다시 점검"}</button>
          ) : null}
        </div>
        <div className="lvl-filter" role="group" aria-label="점검 결과로 거르기">
          <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>전체 <b>{checks.length}</b></button>
          {(["enough", "weak", "missing"] as Level[]).map((l) => (
            <button key={l} type="button" aria-pressed={filter === l} onClick={() => setFilter(l)} title={LEVEL_HINT[l]}>
              <LevelChip level={l} /> <b>{count(l)}</b>
            </button>
          ))}
        </div>
        <ErrorNote error={recheck.error} />
        <div className="checks">
          {shown.map((c) => (
            <article key={c.field} className={`hcheck hcheck--${c.status}`}>
              <header>
                <span className="hcheck__field">{fieldName(c.field)}</span>
                <LevelChip level={c.status} />
              </header>
              <h3>{linked.get(c.field)?.statement || c.hypothesis || `${fieldName(c.field)} 가설이 아직 없습니다`}</h3>
              {c.found ? <p><span className="hcheck__k">자료에서 찾은 것</span>{c.found}</p> : null}
              {c.gap ? <p><span className="hcheck__k">{c.status === "missing" ? "없는 것" : "부족한 것"}</span>{c.gap}</p> : null}
              {c.stale ? <p className="small muted" style={{ margin: 0 }}>{recheck.busy ? "다시 점검하는 중" : "고친 뒤 다시 점검하지 않았습니다"}</p> : null}
              {linked.get(c.field) ? (
                <Link className="hcheck__link" href={`/projects/${projectId}/hypotheses#h-${linked.get(c.field)!.id}`}>가설 화면에서 보기</Link>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <div>
            <h2>Lean Canvas</h2>
            <p>버전 {bm.version}{bm.variant_label ? ` (${bm.variant_label})` : ""}, {dateKo(bm.created_at)}</p>
          </div>
          <div className="form-actions" style={{ marginTop: 0 }}>
            <select className="select" style={{ width: "auto" }} aria-label="버전" value={bm.version} onChange={(e) => setSel(Number(e.target.value))}>
              {versions.map((v) => (
                <option key={v.version} value={v.version}>버전 {v.version}{v.variant_label ? ` ${v.variant_label}` : ""}</option>
              ))}
            </select>
            {canEdit && !editing ? <button className="pill" onClick={() => setEditing(true)}>고쳐서 새 버전 저장</button> : null}
          </div>
        </div>
        {editing ? (
          <div className="panel">
            {FIELDS.map(([k, l]) => (
              <Field key={k} label={l}>
                <textarea className="textarea" style={{ minHeight: 70 }} value={draft[k] ?? ""} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
              </Field>
            ))}
            <div className="field">
              <span>제품이 대신하려는 업무</span>
              <small>업무를 하는 사람(실무자)과 돈을 내는 사람(구매자)을 나눕니다. 진단은 실무자 업무마다 합니다. 최대 10개.</small>
              {tasks.map((t, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 8, alignItems: "center" }}>
                  <input className="input" aria-label={`업무 ${i + 1}`} value={t.name} onChange={(e) => setTasks(tasks.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <select className="select" style={{ width: "auto" }} aria-label={`업무 ${i + 1} 구분`} value={t.role} onChange={(e) => setTasks(tasks.map((x, j) => (j === i ? { ...x, role: e.target.value as "practitioner" | "buyer" } : x)))}>
                    <option value="practitioner">업무를 하는 사람</option>
                    <option value="buyer">돈을 내는 사람</option>
                  </select>
                  <button type="button" className="pill pill--sm" onClick={() => setTasks(tasks.filter((_, j) => j !== i))}>빼기</button>
                </div>
              ))}
              {tasks.length < 10 ? (
                <div><button type="button" className="pill pill--sm" onClick={() => setTasks([...tasks, { name: "", role: "practitioner" }])}>업무 추가</button></div>
              ) : null}
            </div>
            <Field label="변형 이름 (선택)">
              <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <ErrorNote error={save.error} />
            <div className="form-actions">
              <button className="pill pill--ink" disabled={save.busy} onClick={() => void save.run()}>새 버전으로 저장</button>
              <button className="pill pill--quiet" onClick={() => setEditing(false)}>취소</button>
            </div>
          </div>
        ) : (
          <div className="canvas">
            {FIELDS.map(([k, l, cls]) => (
              <div key={k} className={`${cls}${bm[k] ? "" : " empty-cell"}`}>
                <h4>{l} <LevelChip level={checks.find((c) => c.field === k)?.status ?? (bm[k] ? "weak" : "missing")} /></h4>
                <p>{bm[k] || "없음"}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section__head">
          <div>
            <h2>제품이 대신하려는 업무</h2>
          </div>
        </div>
        {bm.tasks.length === 0 ? <p className="muted">업무가 없습니다.</p> : (
          <div className="rows">
            {[...bm.tasks].sort((a, b) => a.position - b.position).map((t) => (
              <div className="row" key={t.id}>
                <div className="row__title">{t.name}</div>
                <div className="row__side"><span className={`badge${t.role === "buyer" ? " badge--ink" : ""}`}>{t.role === "buyer" ? "돈을 내는 사람" : "업무를 하는 사람"}</span></div>
              </div>
            ))}
          </div>
        )}
      </section>

      {versions.length > 1 ? (
        <section className="section">
          <div className="section__head">
            <div>
              <h2>버전 비교</h2>
            </div>
            <select className="select" style={{ width: "auto" }} aria-label="비교할 버전" value={cmp ?? ""} onChange={(e) => setCmp(Number(e.target.value) || null)}>
              <option value="">비교할 버전 고르기</option>
              {versions.filter((v) => v.version !== bm.version).map((v) => (
                <option key={v.version} value={v.version}>버전 {v.version}</option>
              ))}
            </select>
          </div>
          {diff.data ? (
            diff.data.changes.length === 0 ? <p className="muted">달라진 칸이 없습니다.</p> : (
              <div className="table-wrap">
                <table className="t">
                  <thead><tr><th>칸</th><th>버전 {cmp}</th><th>버전 {bm.version}</th></tr></thead>
                  <tbody>
                    {diff.data.changes.map((c) => (
                      <tr key={c.field}>
                        <td>{FIELDS.find(([k]) => k === c.field)?.[1]}</td>
                        <td style={{ whiteSpace: "normal" }}>{c.a || "없음"}</td>
                        <td style={{ whiteSpace: "normal" }}>{c.b || "없음"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : null}
        </section>
      ) : null}
      <ReadOnlyHint />
    </>
  );
}

export default function BusinessModelPage() {
  const { projectId } = useParams<{ projectId: string }>();
  return (
    <ProjectShell
      projectId={projectId}
      stage={(info) => (
        <BmStage projectId={projectId} name={projectName(info?.project.name)} />
      )}
    >
      <Body projectId={projectId} />
    </ProjectShell>
  );
}

function BmStage({ projectId, name }: { projectId: string; name: string }) {
  const { data, reload } = useApi<{ versions: BM[] }>(`/api/projects/${projectId}/business-models`);
  useOnChange("business-models", reload);
  const bm = data?.versions[0];
  return (
    <Stage short crumb={<><b>아이디어 정리 · 사업 모델</b>{name}</>} seed={1}>
      <TiltCard
        kicker={bm ? `가치 제안, 버전 ${bm.version}` : "가치 제안"}
        title={firstSentence(bm?.unique_value_proposition, 80) || "아직 비어 있습니다"}
        sub={firstSentence(bm?.customer_segments, 60) || undefined}
      />
    </Stage>
  );
}
