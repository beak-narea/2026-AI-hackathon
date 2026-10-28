"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { api, useOnChange } from "@/lib/client/api";

/** 위 막대의 알림 표시: 읽지 않은 알림 수 (1분마다 확인) */
export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const path = usePathname();
  const refresh = useCallback(() => {
    api<{ unread: number }>("/api/notifications").then((r) => setUnread(r.unread)).catch(() => {});
  }, []);
  useOnChange("notifications", refresh);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ unread: number }>("/api/notifications")
        .then((r) => alive && setUnread(r.unread))
        .catch(() => {});
    void load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [path]);
  return (
    <Link href="/notifications" className="bell" aria-label={unread ? `읽지 않은 알림 ${unread}개` : "알림"}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 1.5c-2.5 0-4.2 1.9-4.2 4.4v2.7L2.3 11h11.4l-1.5-2.4V5.9C12.2 3.4 10.5 1.5 8 1.5zM6.2 12.6a1.9 1.9 0 0 0 3.6 0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      {unread ? <span className="bell__n num">{unread > 9 ? "9+" : unread}</span> : null}
    </Link>
  );
}
