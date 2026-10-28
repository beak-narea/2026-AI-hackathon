// 자료 점검 세 단계: 충분함 · 부족함 · 없음 (사업 모델 칸 점검과 진단 대체 위험 항목이 같은 말을 쓴다)
export type Level = "enough" | "weak" | "missing";

export const LEVELS: Level[] = ["enough", "weak", "missing"];
export const LEVEL_KO: Record<Level, string> = { enough: "충분함", weak: "부족함", missing: "없음" };
export const LEVEL_HINT: Record<Level, string> = {
  enough: "구체적인 내용과 근거(숫자·사례·출처)가 있다",
  weak: "내용은 있지만 대상·숫자·근거가 모자라다",
  missing: "자료에 내용이 없다",
};

/** 진단 체크리스트 상태(yes·unknown·no)와 세 단계 */
export const STATUS_TO_LEVEL: Record<"yes" | "unknown" | "no", Level> = { yes: "enough", unknown: "weak", no: "missing" };
export const LEVEL_TO_STATUS: Record<Level, "yes" | "unknown" | "no"> = { enough: "yes", weak: "unknown", missing: "no" };

export function LevelChip({ level }: { level: Level }) {
  return <span className={`lvl lvl--${level}`}>{LEVEL_KO[level]}</span>;
}

/** 세 단계를 고르는 버튼 묶음 (색으로도 구분) */
export function LevelPicker({ label, value, onChange, disabled }: { label: string; value: Level; onChange: (v: Level) => void; disabled?: boolean }) {
  return (
    <div className="lvl-pick" role="radiogroup" aria-label={label}>
      {LEVELS.map((l) => (
        <button key={l} type="button" role="radio" aria-checked={value === l} className={value === l ? `lvl lvl--${l}` : "lvl lvl--off"} disabled={disabled}
          title={LEVEL_HINT[l]} onClick={() => onChange(l)}>
          {LEVEL_KO[l]}
        </button>
      ))}
    </div>
  );
}
