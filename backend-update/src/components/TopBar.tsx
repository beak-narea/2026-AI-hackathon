"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "./session";
import { NotificationBell } from "./NotificationBell";

function MenuIcon() {
  return (
    <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true">
      <path d="M0 1h16M0 6h16M0 11h16" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function TopBar() {
  const { session, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const projectId = path.match(/^\/projects\/([0-9a-f-]{36})/)?.[1];
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <header className="bar">
        <div className="bar__left">
          <button className="bar__btn" aria-expanded={open} aria-controls="menu" onClick={() => setOpen((v) => !v)}>
            <MenuIcon /> 메뉴
          </button>
        </div>
        <Link href="/" className="bar__mark" aria-label="검증실 처음으로">
          <span>검증실</span>.
        </Link>
        <div className="bar__right">
          <div className="bar__who">
            {session?.user ? (
              <>
                <NotificationBell />
                <Link className="hide-sm" href="/account">{session.user.name || session.user.email}</Link>
                <button onClick={() => void signOut()}>로그아웃</button>
              </>
            ) : session ? (
              <Link href="/login">로그인</Link>
            ) : null}
          </div>
          <Link className="bar__cta" href={session?.user ? "/projects/new" : "/login?next=/projects/new"}>
            새 프로젝트
          </Link>
        </div>
      </header>
      {open ? <div className="drawer__scrim" onClick={() => setOpen(false)} /> : null}
      <nav id="menu" className="drawer" data-open={open} aria-label="전체 메뉴" inert={!open}>
        <h2>처음</h2>
        <Link href="/">서비스 소개</Link>
        <Link href="/projects">프로젝트 목록</Link>
        <Link href="/projects/00000000-0000-4000-8000-000000000001">예시 프로젝트</Link>
        {projectId ? (
          <>
            <h2>이 프로젝트</h2>
            <Link href={`/projects/${projectId}`}>대시보드</Link>
            <Link href={`/projects/${projectId}/hypotheses`}>가설</Link>
            <Link href={`/projects/${projectId}/proposals`}>검증 제안</Link>
            <Link href={`/projects/${projectId}/verdicts`}>결과 판정</Link>
          </>
        ) : null}
        <h2>계정</h2>
        <Link href="/archive">보관함</Link>
        {session?.user ? (
          <>
            <Link href="/notifications">알림</Link>
            <Link href="/account">내 계정</Link>
          </>
        ) : <Link href="/login">로그인</Link>}
        {session?.is_admin ? (
          <>
            <h2>운영</h2>
            <Link href="/admin">운영자 화면</Link>
          </>
        ) : null}
        <h2>안내</h2>
        <Link href="/terms">이용약관</Link>
        <Link href="/privacy">개인정보 처리방침</Link>
      </nav>
    </>
  );
}
