"use client";
import { useParams } from "next/navigation";
import { ProjectShell, ReadOnlyHint, useProject } from "@/components/ProjectShell";
import { Stage, TiltCard } from "@/components/Stage";
import { api, dateKo, useAction, useApi } from "@/lib/client/api";
import { Empty, ErrorNote, Loading, toast } from "@/components/ui";
import { projectName } from "@/lib/client/format";

interface RawFile {
  id: string; proposal_id: string | null; name: string; kind: string; size_bytes: number; pseudonymized: Record<string, number>;
  deleted_at: string | null; created_at: string; expires_at: string | null;
}

const KIND_KO: Record<string, string> = { email: "이메일", phone: "전화", rrn: "주민번호", card: "카드", bizno: "사업자번호", url: "주소", name: "이름", company: "회사" };
const size = (b: number) => (b < 1024 ? `${b}B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)}KB` : `${(b / 1024 / 1024).toFixed(1)}MB`);

function Body({ projectId }: { projectId: string }) {
  const { canEdit } = useProject();
  // 원자료는 팀(소유자·팀원)만 본다. 외부 평가자는 볼 수 없다.
  const isMember = canEdit;
  const { data, loading, error, reload } = useApi<{ retention_days: number; files: RawFile[] }>(isMember ? `/api/projects/${projectId}/raw-files` : null);
  const remove = useAction(async (id: string) => {
    await api(`/api/projects/${projectId}/raw-files/${id}`, { method: "DELETE" });
    toast("원자료를 지웠습니다. 판정에 쓴 숫자는 남습니다.");
    await reload();
  });
  if (!isMember) return <ReadOnlyHint />;
  if (loading) return <Loading />;
  const files = data?.files ?? [];
  const live = files.filter((f) => !f.deleted_at);
  return (
    <>
      <ErrorNote error={error ?? remove.error} />
      <p className="small muted">보관 기간 {data?.retention_days ?? 365}일</p>
      <section className="section">
        <div className="section__head"><h2>원자료 <span className="num">{live.length}</span></h2></div>
        {files.length === 0 ? (
          <Empty title="올린 원자료가 없습니다" />
        ) : (
          <div className="rows">
            {files.map((f) => (
              <div className="row" key={f.id}>
                <div>
                  <div className="row__title">{f.name}</div>
                  <div className="row__meta">
                    {f.kind.toUpperCase()}, {size(f.size_bytes)}, {dateKo(f.created_at)}
                    {Object.entries(f.pseudonymized ?? {}).filter(([, n]) => n > 0).map(([k, n]) => <span key={k} className="badge">{KIND_KO[k] ?? k} {n}개 가명</span>)}
                    {f.deleted_at ? <span className="badge">삭제됨 {dateKo(f.deleted_at)}</span> : <span>삭제 예정 {dateKo(f.expires_at)}</span>}
                  </div>
                </div>
                <div className="row__side">
                  {!f.deleted_at ? <a className="pill pill--sm" href={`/api/projects/${projectId}/raw-files/${f.id}`}>내려받기</a> : null}
                  {!f.deleted_at && canEdit ? (
                    <button className="pill pill--sm" disabled={remove.busy} onClick={() => { if (window.confirm(`${f.name}을(를) 지울까요? 되돌릴 수 없습니다.`)) void remove.run(f.id); }}>지우기</button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

export default function FilesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  return (
    <ProjectShell projectId={projectId} stage={(info) => (
      <Stage short crumb={<><b>설정 · 원자료</b>{projectName(info?.project.name)}</>} seed={12}>
        <TiltCard title="가명 처리한 원자료" />
      </Stage>
    )}>
      <Body projectId={projectId} />
    </ProjectShell>
  );
}
