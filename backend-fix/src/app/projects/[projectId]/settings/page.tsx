"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ProjectShell, ReadOnlyHint, useProject } from "@/components/ProjectShell";
import { Stage, TiltCard } from "@/components/Stage";
import { api, useAction, useApi } from "@/lib/client/api";
import { ErrorNote, Field, Note, Segmented, toast } from "@/components/ui";
import { projectName } from "@/lib/client/format";

interface M { id: string; email: string; name: string; role: "owner" | "member" | "external_rater"; joined_at: string | null }
const ROLE: Record<string, string> = { owner: "소유자", member: "팀원", external_rater: "외부 평가자" };

function Body({ projectId }: { projectId: string }) {
  const { info, canEdit, reload: reloadProject } = useProject();
  const router = useRouter();
  const members = useApi<{ members: M[] }>(info?.my_role ? `/api/projects/${projectId}/members` : null);
  const [name, setName] = useState("");
  const [b2b, setB2b] = useState<"b2b" | "traffic">("traffic");
  const [cycle, setCycle] = useState("2");
  const [retention, setRetention] = useState("365");
  useEffect(() => {
    if (info) {
      setName(info.project.name);
      setB2b(info.project.is_b2b ? "b2b" : "traffic");
      setCycle(String(info.project.review_cycle_weeks ?? 2));
      setRetention(String(info.project.raw_retention_days ?? 365));
    }
  }, [info]);
  const requests = useApi<{ requests: Array<{ id: string; topic: string; status: string; created_at: string; mentors: { name: string; organization: string } | null }> }>(
    info?.my_role ? `/api/projects/${projectId}/mentor-requests` : null,
  );
  const cancel = useAction(async (id: string) => {
    await api(`/api/projects/${projectId}/mentor-requests/${id}`, { method: "DELETE" });
    await requests.reload();
  });
  const save = useAction(async () => {
    await api(`/api/projects/${projectId}`, {
      method: "PATCH",
      body: { name, is_b2b: b2b === "b2b", review_cycle_weeks: Number(cycle) || 2, raw_retention_days: Number(retention) || 365 },
    });
    toast("저장했습니다");
    await reloadProject();
  });
  const [email, setEmail] = useState("");
  const [mname, setMname] = useState("");
  const [role, setRole] = useState<"member" | "external_rater">("member");
  const [invited, setInvited] = useState<string | null>(null);
  const invite = useAction(async () => {
    const r = await api<{ invite_email_sent: boolean; invite_error?: string; member: { user_id: string | null } }>(`/api/projects/${projectId}/members`, { body: { email, name: mname, role } });
    setInvited(
      r.invite_error
        ? `${email}을(를) 명단에 넣었지만 초대 메일을 보내지 못했습니다 (${r.invite_error}). 직접 가입하라고 알려 주세요. 같은 이메일로 가입하고 확인하면 자동으로 연결됩니다.`
        : r.invite_email_sent
          ? `${email}로 초대 메일을 보냈습니다`
          : r.member.user_id
            ? `${email}을(를) 바로 추가했습니다`
            : `${email}을(를) 명단에 넣었습니다. 가입하고 이메일을 확인하면 연결됩니다.`,
    );
    setEmail(""); setMname("");
    await members.reload();
  });
  const remove = useAction(async (id: string) => {
    await api(`/api/projects/${projectId}/members/${id}`, { method: "DELETE" });
    await members.reload();
  });
  const [reason, setReason] = useState("");
  const archive = useAction(async () => {
    await api(`/api/projects/${projectId}/archive`, { body: { reason } });
    router.push("/archive");
  });
  if (!canEdit) return <ReadOnlyHint />;
  return (
    <>
      <section className="section">
        <div className="section__head"><h2>프로젝트</h2></div>
        <div className="panel">
          <Field label="이름"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <div className="field">
            <span>고객을 만나는 방식</span>
            <Segmented label="고객을 만나는 방식" value={b2b} onChange={setB2b} options={[{ value: "traffic", label: "방문자가 있다" }, { value: "b2b", label: "영업으로 만난다 (B2B)" }]} />
          </div>
          <div className="grid2">
            <Field label="점검 주기 (주)" hint="이 주기마다 대시보드에서 증거와 계획을 점검하고 기록합니다 (1~12주)">
              <input className="input" inputMode="numeric" value={cycle} onChange={(e) => setCycle(e.target.value)} />
            </Field>
            <Field label="원자료 보관 기간 (일)" hint="지나면 가명 처리한 원자료 파일을 자동으로 지웁니다. 판정 숫자는 남습니다 (7~3650일)">
              <input className="input" inputMode="numeric" value={retention} onChange={(e) => setRetention(e.target.value)} />
            </Field>
          </div>
          <ErrorNote error={save.error} />
          <button className="pill pill--ink" disabled={save.busy} onClick={() => void save.run()}>저장</button>
        </div>
      </section>
      <section className="section">
        <div className="section__head">
          <div>
            <h2>팀원과 평가자</h2>
            <p>치명 후보 가정은 팀 밖 평가자 1명이 함께 매겨야 확정할 수 있습니다. 멘토나 업계 지인을 외부 평가자로 초대하세요.</p>
          </div>
        </div>
        <div className="rows" style={{ marginBottom: 16 }}>
          {(members.data?.members ?? []).map((m) => (
            <div className="row" key={m.id}>
              <div>
                <div className="row__title">{m.name || m.email}</div>
                <div className="row__meta">{m.email}{m.joined_at ? "" : ", 초대 수락 전"}</div>
              </div>
              <div className="row__side">
                <span className={`badge${m.role === "owner" ? " badge--ink" : m.role === "external_rater" ? " badge--info" : ""}`}>{ROLE[m.role]}</span>
                {m.role !== "owner" ? <button className="pill pill--sm" disabled={remove.busy} onClick={() => void remove.run(m.id)}>내보내기</button> : null}
              </div>
            </div>
          ))}
        </div>
        <div className="panel">
          <h3>초대</h3>
          <div className="grid2">
            <Field label="이메일"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="이름"><input className="input" value={mname} onChange={(e) => setMname(e.target.value)} /></Field>
          </div>
          <div className="field">
            <span>역할</span>
            <Segmented label="역할" value={role} onChange={setRole} options={[{ value: "member", label: "팀원" }, { value: "external_rater", label: "외부 평가자 (중요도만 매김)" }]} />
          </div>
          <ErrorNote error={invite.error ?? remove.error} />
          {invited ? <Note tone="good"><p>{invited}</p></Note> : null}
          <button className="pill pill--ink" disabled={invite.busy || !email} onClick={() => void invite.run()}>초대</button>
        </div>
      </section>
      {(requests.data?.requests ?? []).length ? (
        <section className="section">
          <div className="section__head"><div><h2>외부 평가자 연결 요청</h2><p>배정되면 외부 평가자로 초대되고 알림이 갑니다.</p></div></div>
          <div className="rows">
            {requests.data!.requests.map((r) => (
              <div className="row" key={r.id}>
                <div>
                  <div className="row__title">{r.topic || "외부 평가자 요청"}</div>
                  <div className="row__meta">{r.mentors ? `${r.mentors.name}${r.mentors.organization ? ` (${r.mentors.organization})` : ""}` : "배정 전"}</div>
                </div>
                <div className="row__side">
                  <span className={`badge${r.status === "matched" ? " badge--met" : r.status === "requested" ? " badge--on_hold" : ""}`}>
                    {{ requested: "요청함", matched: "배정됨", done: "끝남", cancelled: "취소" }[r.status] ?? r.status}
                  </span>
                  {r.status === "requested" ? <button className="pill pill--sm" disabled={cancel.busy} onClick={() => void cancel.run(r.id)}>취소</button> : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <section className="section">
        <div className="section__head"><div><h2>보관하기</h2><p>판정 없이 접을 때 씁니다. 근거를 갖고 접는다면 의사결정에서 중단을 고르세요.</p></div></div>
        <div className="sub">
          <Field label="보관 사유"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <ErrorNote error={archive.error} />
          <button className="pill" disabled={archive.busy || !reason} onClick={() => void archive.run()}>보관함으로 옮기기</button>
        </div>
      </section>
    </>
  );
}

export default function SettingsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  return (
    <ProjectShell projectId={projectId} stage={(info) => (
      <Stage short crumb={<><b>프로젝트 설정</b>{projectName(info?.project.name)}</>} seed={11}>
        <TiltCard title={projectName(info?.project.name) || " "} sub="이름, 고객을 만나는 방식, 함께 매길 사람을 정합니다." />
      </Stage>
    )}>
      <Body projectId={projectId} />
    </ProjectShell>
  );
}
