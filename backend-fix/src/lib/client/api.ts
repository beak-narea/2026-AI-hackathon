"use client";
// 화면에서 API를 부르는 도우미. 오류는 서버의 { error: { code, message, details } } 형식 그대로 넘긴다.
import { useCallback, useEffect, useRef, useState } from "react";

export class ApiFailure extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
  fieldErrors(): Record<string, string[]> {
    const d = this.details as { fieldErrors?: Record<string, string[]> } | undefined;
    return d?.fieldErrors ?? {};
  }
}

export async function api<T = any>(path: string, init?: { method?: string; body?: unknown; form?: FormData }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body !== undefined || init?.form ? "POST" : "GET"),
    headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.form ?? (init?.body !== undefined ? JSON.stringify(init.body) : undefined),
    credentials: "same-origin",
  });
  if (!res.ok) {
    let err: { code?: string; message?: string; details?: unknown } = {};
    try {
      err = ((await res.json()) as { error?: typeof err }).error ?? {};
    } catch {
      // 본문 없음
    }
    throw new ApiFailure(res.status, err.code ?? "http_" + res.status, err.message ?? `요청 실패 (${res.status})`, err.details);
  }
  const type = res.headers.get("content-type") ?? "";
  return (type.includes("json") ? res.json() : res.text()) as Promise<T>;
}

export function useApi<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const lastPath = useRef<string | null>(path);
  const load = useCallback(async () => {
    // 주소가 바뀌면 이전 주소의 데이터를 비운다 (다른 대상의 값으로 요청을 보내지 않게)
    if (lastPath.current !== path) {
      lastPath.current = path;
      setData(null);
      setError(null);
    }
    if (!path) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (n === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) setError(e as ApiFailure);
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);
  // 다시 불러올 때는 기존 화면을 유지한다 (펼친 항목, 입력 중인 값이 사라지지 않게)
  return { data, error, loading: loading && data === null, refreshing: loading, reload: load, setData };
}

/** 버튼 하나의 비동기 동작: 진행 중 표시와 오류를 함께 다룬다 */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFailure | null>(null);
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      setBusy(true);
      setError(null);
      try {
        return await fn(...args);
      } catch (e) {
        setError(e instanceof ApiFailure ? e : new ApiFailure(0, "client", (e as Error).message));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [fn],
  );
  return { run, busy, error, setError };
}

export const pct = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined || Number.isNaN(v) ? "–" : `${(v * 100).toFixed(digits)}%`;

export const dateKo = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" }) : "–";

// 같은 화면의 다른 부분(무대와 본문)이 같은 데이터를 쓸 때 다시 불러오라고 알린다
const bus: EventTarget | null = typeof window !== "undefined" ? new EventTarget() : null;
export const emitChange = (key: string) => {
  bus?.dispatchEvent(new Event(key));
};
export function useOnChange(key: string, fn: () => void) {
  useEffect(() => {
    if (!bus) return;
    const h = () => fn();
    bus.addEventListener(key, h);
    return () => bus.removeEventListener(key, h);
  }, [key, fn]);
}
