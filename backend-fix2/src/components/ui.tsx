"use client";
import { useEffect, useState, type ReactNode } from "react";
import type { ApiFailure } from "@/lib/client/api";

/** 되돌릴 수 없는 동작: 한 번 누르면 "한 번 더 눌러 확인"으로 바뀌고, 4초 안에 다시 눌러야 실행한다 (브라우저 확인 창 없이) */
export function ConfirmButton({ label, confirmLabel, onConfirm, disabled, className = "pill pill--sm" }: {
  label: string; confirmLabel?: string; onConfirm: () => void; disabled?: boolean; className?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={armed ? `${className} pill--danger` : className}
      disabled={disabled}
      aria-live="polite"
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? (confirmLabel ?? `정말 ${label}?`) : label}
    </button>
  );
}

export function Note({ tone, children }: { tone?: "warn" | "bad" | "good" | "info"; children: ReactNode }) {
  return <div className={`note${tone ? ` note--${tone}` : ""}`} role={tone === "bad" ? "alert" : undefined}>{children}</div>;
}

// 서버 입력 칸 이름 → 화면 이름 (없으면 칸 이름 그대로)
const FIELD_LABELS: Record<string, string> = {
  name: "이름", email: "메일", statement: "가정", type: "유형", idea_text: "아이디어 설명", text: "내용",
  attempts: "시도", responses: "응답", successes: "성공", clusters: "묶음 수", cluster_successes: "성공한 묶음 수", icc: "ICC",
  method_diff_reason: "방법이 달라진 이유", actual_method_key: "실제로 쓴 방법", recruitment: "모집 방법", memo: "메모",
  acquaintance_ratio: "지인 비율", same_company_count: "같은 회사 수", target_value: "목표값", min_value: "최소 허용치",
  expected_rate: "예상 비율", cluster_size: "묶음 크기", weeks: "예상 기간(주)", expected_weeks: "예상 기간(주)",
  review_cycle_weeks: "점검 주기(주)", raw_retention_days: "원자료 보관 기간(일)", window_days: "기간(일)",
  numerator_event: "분자 이벤트", denominator_event: "분모 이벤트", event_name: "이벤트 이름", definition: "정의",
  n: "표본 수", note: "메모", reason: "이유", topic: "주제", instruction: "지시문", samples: "샘플",
};

export function ErrorNote({ error }: { error: ApiFailure | null | undefined }) {
  if (!error) return null;
  const fields = error.fieldErrors();
  const general = error.formErrors();
  return (
    <Note tone="bad">
      <p><strong>{error.message}</strong></p>
      {general.map((m) => (
        <p key={m} className="small">{m}</p>
      ))}
      {Object.entries(fields).map(([k, v]) => (
        <p key={k} className="small">{FIELD_LABELS[k] ?? k}: {v.join(", ")}</p>
      ))}
    </Note>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

export function Loading({ lines = 3 }: { lines?: number }) {
  return (
    <div aria-busy="true" aria-label="불러오는 중" style={{ display: "grid", gap: 10 }}>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${90 - i * 15}%` }} />
      ))}
    </div>
  );
}

export function Field({
  label, hint, error, children,
}: { label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
      {error ? <span className="err">{error}</span> : null}
    </label>
  );
}

let pushToast: ((msg: string, bad?: boolean) => void) | null = null;
export function toast(msg: string, bad = false) {
  pushToast?.(msg, bad);
}

export function Toaster() {
  const [t, setT] = useState<{ msg: string; bad: boolean } | null>(null);
  useEffect(() => {
    pushToast = (msg, bad = false) => setT({ msg, bad });
    return () => {
      pushToast = null;
    };
  }, []);
  useEffect(() => {
    if (!t) return;
    const id = setTimeout(() => setT(null), 3200);
    return () => clearTimeout(id);
  }, [t]);
  return t ? (
    <div className={`toast${t.bad ? " toast--bad" : ""}`} role="status" aria-live="polite">
      {t.msg}
    </div>
  ) : null;
}

export function Segmented<T extends string>({
  value, options, onChange, label,
}: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button type="button" key={o.value} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
