"use client";
import Link from "next/link";
import { Stage, TiltCard } from "@/components/Stage";
import { api, dateKo, emitChange, useAction, useApi } from "@/lib/client/api";
import { useSession } from "@/components/session";
import { Empty, ErrorNote, Loading } from "@/components/ui";

interface N { id: string; kind: string; title: string; body: string; link: string | null; read_at: string | null; created_at: string }

export default function Notifications() {
  const { session } = useSession();
  const { data, loading, error, reload } = useApi<{ notifications: N[]; unread: number }>(session?.user ? "/api/notifications" : null);
  const readAll = useAction(async () => {
    await api("/api/notifications", { body: { all: true } });
    await reload();
    emitChange("notifications");
  });
  const readOne = (id: string) => void api("/api/notifications", { body: { ids: [id] } }).then(() => emitChange("notifications")).catch(() => {});
  const list = data?.notifications ?? [];
  return (
    <>
      <Stage short crumb={<b>알림</b>}>
        <TiltCard title="알림" sub="미달 판정, 점검일, 예상 기간이 지난 제안, 외부 평가자 연결을 알려 드립니다. 결과 제출을 독촉하지는 않습니다." />
      </Stage>
      <div className="work work--wide">
        <main id="main">
          <ErrorNote error={error ?? readAll.error} />
          {!session ? <Loading /> : !session.user ? (
            <Empty title="로그인이 필요합니다" action={<Link className="pill pill--ink" href="/login?next=/notifications">로그인</Link>} />
          ) : loading ? <Loading /> : list.length === 0 ? (
            <Empty title="알림이 없습니다" />
          ) : (
            <section className="section">
              <div className="section__head">
                <h2>읽지 않음 <span className="num">{data?.unread ?? 0}</span></h2>
                {data?.unread ? <button className="pill pill--sm" disabled={readAll.busy} onClick={() => void readAll.run()}>모두 읽음</button> : null}
              </div>
              <div className="rows">
                {list.map((n) => (
                  <div className="row" key={n.id}>
                    <div>
                      <div className="row__title">{n.read_at ? null : <span className="badge badge--info" style={{ marginRight: 8 }}>새 알림</span>}{n.title}</div>
                      <div className="row__meta" style={{ whiteSpace: "pre-wrap" }}>{n.body}</div>
                      <div className="row__meta">{dateKo(n.created_at)}</div>
                    </div>
                    <div className="row__side">
                      {n.link ? <Link className="pill pill--sm" href={n.link} onClick={() => readOne(n.id)}>열기</Link> : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>
      </div>
    </>
  );
}
