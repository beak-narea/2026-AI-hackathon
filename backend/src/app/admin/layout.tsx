"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Stage, TiltCard } from "@/components/Stage";
import { useSession } from "@/components/session";
import { Empty, Loading } from "@/components/ui";

const TABS: Array<[string, string]> = [
  ["/admin", "개요"],
  ["/admin/cohorts", "성공 기준"],
  ["/admin/pricing", "가격·비용"],
  ["/admin/evals", "아첨 점검"],
  ["/admin/coding", "코딩 일치도"],
  ["/admin/quality", "척도·설계 가정"],
  ["/admin/mentors", "외부 평가자"],
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const path = usePathname();
  const title = TABS.find(([href]) => href === path)?.[1] ?? "운영자";
  return (
    <>
      <Stage short crumb={<><b>운영자</b>{title}</>} seed={13}>
        <TiltCard title={title} />
      </Stage>
      <nav className="admin-tabs" aria-label="운영자 메뉴">
        {TABS.map(([href, label]) => (
          <Link key={href} href={href} aria-current={path === href ? "page" : undefined}>{label}</Link>
        ))}
      </nav>
      <div className="work work--wide">
        <main id="main">
          {!session ? <Loading /> : !session.user ? (
            <Empty title="로그인이 필요합니다" action={<Link className="pill pill--ink" href={`/login?next=${path}`}>로그인</Link>} />
          ) : !session.is_admin ? (
            <Empty title="운영자만 볼 수 있습니다">운영자 이메일은 서버 환경 변수 ADMIN_EMAILS로 정합니다.</Empty>
          ) : children}
        </main>
      </div>
    </>
  );
}
