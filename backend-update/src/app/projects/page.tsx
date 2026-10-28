"use client";
import Link from "next/link";
import { Stage, TiltCard } from "@/components/Stage";
import { Ring } from "@/components/Ring";
import { useApi, dateKo } from "@/lib/client/api";
import { useSession } from "@/components/session";
import { Empty, ErrorNote, Loading } from "@/components/ui";

interface P { id: string; name: string; idea_text: string; status: string; is_example: boolean; is_b2b: boolean; updated_at: string; my_role?: string }

export default function ProjectList() {
  const { session } = useSession();
  const { data, error, loading } = useApi<{ examples: P[]; projects: P[] }>(session?.user ? "/api/projects" : null);
  const active = (data?.projects ?? []).filter((p) => p.status === "active");
  const archived = (data?.projects ?? []).filter((p) => p.status === "archived");

  return (
    <>
      <Stage
        short
        crumb={<b>프로젝트 목록</b>}
        actions={<Link className="pill pill--go" href={session?.user ? "/projects/new" : "/login?next=/projects/new"}>새 프로젝트</Link>}
      >
        <TiltCard title="내 프로젝트" sub={session?.user ? "아이디어 하나가 프로젝트 하나입니다." : "로그인하면 내 프로젝트가 여기에 모입니다."}>
          <Ring value={active.length} max={Math.max(active.length, 1)} display={String(active.length)} unit="개" label="진행 중" tone="teal" />
          <Ring value={archived.length} max={Math.max(active.length + archived.length, 1)} display={String(archived.length)} unit="개" label="보관함" tone="stone" />
        </TiltCard>
      </Stage>
      <div className="work work--wide">
        <main id="main">
          <ErrorNote error={error} />
          <section className="section">
            <div className="section__head"><h2>진행 중</h2></div>
            {!session ? <Loading /> : !session.user ? (
              <Empty title="로그인이 필요합니다" action={<Link className="pill pill--ink" href="/login?next=/projects">로그인</Link>}>
                예시 프로젝트는 로그인 없이 볼 수 있습니다.
              </Empty>
            ) : loading ? <Loading /> : active.length === 0 ? (
              <Empty title="아직 프로젝트가 없습니다" action={<Link className="pill pill--ink" href="/projects/new">첫 프로젝트 만들기</Link>}>
                아이디어 설명 몇 줄이나 피치덱만 있으면 시작할 수 있습니다.
              </Empty>
            ) : (
              <div className="rows">
                {active.map((p) => (
                  <Link className="row" key={p.id} href={`/projects/${p.id}`}>
                    <div>
                      <div className="row__title">{p.name}</div>
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
                    <div className="row__title">{p.name.replace(/^예시 · /, "")}</div>
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
