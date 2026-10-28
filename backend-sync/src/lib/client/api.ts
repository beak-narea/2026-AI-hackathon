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
  /** 칸 하나에 묶이지 않는 규칙 위반 (예: 성공 ≤ 응답 ≤ 시도) */
  formErrors(): string[] {
    const d = this.details as { formErrors?: string[] } | undefined;
    return d?.formErrors ?? [];
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
  const out = (await (type.includes("json") ? res.json() : res.text())) as T;
  // 무언가를 바꾸는 요청이 성공하면, 같은 프로젝트의 데이터를 보여 주는 모든 부분(무대 카드, 메뉴, 다른 목록)이 다시 불러온다
  const method = init?.method ?? (init?.body !== undefined || init?.form ? "POST" : "GET");
  if (method !== "GET") announceMutation(path);
  return out;
}

/** 같은 프로젝트(/api/projects/<id>) 아래면 같은 데이터 묶음으로 본다 */
function scopeOf(path: string): string {
  const m = path.match(/^\/api\/projects\/([^/?]+)/);
  return m ? `project:${m[1]}` : path.split("?")[0]!.split("/").slice(0, 3).join("/");
}

const mutationBus: EventTarget | null = typeof window !== "undefined" ? new EventTarget() : null;
function announceMutation(path: string) {
  mutationBus?.dispatchEvent(new CustomEvent("mutated", { detail: scopeOf(path) }));
}

export function useApi<T = any>(path: string | null) {
  // 데이터와 오류는 어느 주소의 것인지 함께 기억한다. 주소가 바뀐 첫 화면부터 이전 대상의 값을 보여 주지 않는다
  const [state, setState] = useState<{ path: string | null; data: T | null; error: ApiFailure | null }>({ path, data: null, error: null });
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) {
      setState({ path, data: null, error: null });
      setLoading(false);
      return;
    }
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (n === seq.current) setState({ path, data: d, error: null });
    } catch (e) {
      if (n === seq.current) setState((s) => ({ path, data: s.path === path ? s.data : null, error: e as ApiFailure }));
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);
  // 같은 범위의 데이터가 바뀌었다는 알림이 오면 다시 불러온다 (연달아 오면 한 번만)
  useEffect(() => {
    if (!path || !mutationBus) return;
    const mine = scopeOf(path);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const h = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== mine) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), 60);
    };
    mutationBus.addEventListener("mutated", h);
    return () => {
      mutationBus.removeEventListener("mutated", h);
      if (timer) clearTimeout(timer);
    };
  }, [path, load]);
  const current = state.path === path;
  const data = current ? state.data : null;
  const error = current ? state.error : null;
  const setData = useCallback(
    (v: T | null | ((prev: T | null) => T | null)) =>
      setState((s) => ({ ...s, path, data: typeof v === "function" ? (v as (p: T | null) => T | null)(s.path === path ? s.data : null) : v })),
    [path],
  );
  // 다시 불러올 때는 기존 화면을 유지한다 (펼친 항목, 입력 중인 값이 사라지지 않게)
  return { data, error, loading: (loading || !current) && data === null && !!path, refreshing: loading, reload: load, setData };
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
