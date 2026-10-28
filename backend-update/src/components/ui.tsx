"use client";
import { useEffect, useState, type ReactNode } from "react";
import type { ApiFailure } from "@/lib/client/api";

export function Note({ tone, children }: { tone?: "warn" | "bad" | "good" | "info"; children: ReactNode }) {
  return <div className={`note${tone ? ` note--${tone}` : ""}`} role={tone === "bad" ? "alert" : undefined}>{children}</div>;
}

export function ErrorNote({ error }: { error: ApiFailure | null | undefined }) {
  if (!error) return null;
  const fields = error.fieldErrors();
  return (
    <Note tone="bad">
      <p><strong>{error.message}</strong></p>
      {Object.entries(fields).map(([k, v]) => (
        <p key={k} className="small">{k}: {v.join(", ")}</p>
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
