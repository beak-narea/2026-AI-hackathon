"use client";
import Link from "next/link";
import { Stage, TiltCard } from "@/components/Stage";
import { api, dateKo, useAction, useApi } from "@/lib/client/api";
import { useSession } from "@/components/session";
import { Empty, ErrorNote, Loading, toast } from "@/components/ui";

interface P { id: string; name: string; archive_reason: string | null; archived_at: string | null; status: string; my_role: string | null }

export default function Archive() {
  const { session } = useSession();
  const { data, loading, error, reload } = useApi<{ projects: P[] }>(session?.user ? "/api/projects" : null);
  const archived = (data?.projects ?? []).filter((p) => p.status === "archived");
  const restore = useAction(async (id: string) => {
    await api(`/api/projects/${id}/restore`, { method: "POST" });
    toast("프로젝트를 되살렸습니다");
    await reload();
  });
  return (
    <>
      <Stage short crumb={<b>보관함</b>}>
        <TiltCard title="접은 아이디어" sub="근거를 갖고 접은 것도 성과입니다. 기록은 남겨 둡니다." />
      </Stage>
      <div className="work work--wide">
        <main id="main">
          <ErrorNote error={error ?? restore.error} />
          {!session ? <Loading /> : !session.user ? (
            <Empty title="로그인이 필요합니다" action={<Link className="pill pill--ink" href="/login?next=/archive">로그인</Link>} />
          ) : loading ? <Loading /> : archived.length === 0 ? (
            <Empty title="보관함이 비어 있습니다">의사결정에서 중단을 고르거나 프로젝트 설정에서 보관하면 여기로 옵니다.</Empty>
          ) : (
            <div className="rows">
              {archived.map((p) => (
                <div className="row" key={p.id}>
                  <div>
                    <Link className="row__title" href={`/projects/${p.id}`}>{p.name}</Link>
                    <div className="row__meta">{dateKo(p.archived_at)}에 보관. 사유: {p.archive_reason ?? "없음"}</div>
                  </div>
                  <div className="row__side">
                    {p.my_role === "owner" || p.my_role === "member" ? (
                      <button className="pill pill--sm" disabled={restore.busy} onClick={() => void restore.run(p.id)}>되살리기</button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </>
  );
}
