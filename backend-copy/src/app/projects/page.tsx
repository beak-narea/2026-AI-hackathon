"use client";
import Link from "next/link";
import { Stage, TiltCard } from "@/components/Stage";
import { Ring } from "@/components/Ring";
import { useApi, dateKo } from "@/lib/client/api";
import { useSession } from "@/components/session";
import { Empty, ErrorNote, Loading } from "@/components/ui";

type Phase = "planning" | "running" | "closed";
interface P { id: string; name: string; idea_text: string; status: string; is_example: boolean; is_b2b: boolean; updated_at: string; my_role?: string; phase?: Phase }

const PHASE_KO: Record<Phase, string> = { planning: "계획", running: "진행 중", closed: "마감" };
const PHASE_ORDER: Record<Phase, number> = { running: 0, planning: 1, closed: 2 };

/** 프로젝트 단계 꼬리표 (시그니처 민트) */
function PhaseBadge({ phase }: { phase?: Phase }) {
  if (!phase) return null;
  return <span className={`phase phase--${phase}`}>{PHASE_KO[phase]}</span>;
}

export default function ProjectList() {
  const { session } = useSession();
  const { data, error, loading } = useApi<{ examples: P[]; projects: P[] }>(session?.user ? "/api/projects" : null);
  // 진행 중 → 계획 → 마감 순, 같은 단계는 최근에 고친 것부터
  const all = [...(data?.projects ?? [])].sort((a, b) => PHASE_ORDER[a.phase ?? "planning"] - PHASE_ORDER[b.phase ?? "planning"]);
  const count = (ph: Phase) => all.filter((p) => p.phase === ph).length;

  return (
    <>
      <Stage
        short
        crumb={<b>프로젝트 목록</b>}
        actions={<Link className="pill pill--go" href={session?.user ? "/projects/new" : "/login?next=/projects/new"}>새 프로젝트</Link>}
      >
        <TiltCard title="내 프로젝트">
          <Ring value={count("running")} max={Math.max(all.length, 1)} display={String(count("running"))} unit="개" label="진행 중" tone="teal" />
          <Ring value={count("planning")} max={Math.max(all.length, 1)} display={String(count("planning"))} unit="개" label="계획" tone="cyan" />
          <Ring value={count("closed")} max={Math.max(all.length, 1)} display={String(count("closed"))} unit="개" label="마감" tone="stone" />
        </TiltCard>
      </Stage>
      <div className="work work--wide">
        <main id="main">
          <ErrorNote error={error} />
          <section className="section">
            <div className="section__head"><h2>내 프로젝트</h2></div>
            {!session ? <Loading /> : !session.user ? (
              <Empty title="로그인이 필요합니다" action={<Link className="pill pill--ink" href="/login?next=/projects">로그인</Link>} />
            ) : loading ? <Loading /> : all.length === 0 ? (
              <Empty title="아직 프로젝트가 없습니다" action={<Link className="pill pill--ink" href="/projects/new">첫 프로젝트 만들기</Link>} />
            ) : (
              <div className="rows">
                {all.map((p) => (
                  <Link className="row" key={p.id} href={`/projects/${p.id}`}>
                    <div>
                      <div className="row__title">{p.name} <PhaseBadge phase={p.phase} /></div>
                      <div className="row__meta">{p.idea_text.slice(0, 80) || "아이디어 설명 없음"}</div>
                    </div>
                    <div className="row__side small muted">{dateKo(p.updated_at)}</div>
                  </Link>
                ))}
              </div>
            )}
          </section>
          <section className="section">
            <div className="section__head"><h2>예시</h2></div>
            <div className="rows">
              {(data?.examples ?? [{ id: "00000000-0000-4000-8000-000000000001", name: "예시 · 세무 증빙 자동 분류 AI", idea_text: "", status: "active", is_example: true, is_b2b: true, updated_at: "" }]).map((p) => (
                <Link className="row" key={p.id} href={`/projects/${p.id}`}>
                  <div>
                    <div className="row__title">{p.name.replace(/^예시 · /, "")} <PhaseBadge phase={p.phase} /></div>
                    <div className="row__meta">진단부터 결정까지 채운 가상 사례입니다.</div>
                  </div>
                  <div className="row__side"><span className="badge badge--example">예시</span></div>
                </Link>
              ))}
            </div>
          </section>
        </main>
      </div>
    </>
  );
}
