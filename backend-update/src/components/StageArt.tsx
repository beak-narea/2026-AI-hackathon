// 무대 그림 (원래 그림): 가운데에서 뻗는 가는 광선과 네 갈래 별. 구름은 화면 전체에 고정된 SceneArt가 그린다.

export function starPath(cx: number, cy: number, r: number) {
  return `M${cx},${cy - r} Q${cx},${cy} ${cx + r * 0.62},${cy} Q${cx},${cy} ${cx},${cy + r} Q${cx},${cy} ${cx - r * 0.62},${cy} Q${cx},${cy} ${cx},${cy - r}Z`;
}

function rays() {
  const cx = 720;
  const cy = 200;
  const out: string[] = [];
  for (let i = 0; i < 34; i++) {
    const a = (i / 34) * Math.PI * 2 + 0.05;
    const r0 = 180 + ((i * 37) % 50);
    const r1 = 420 + ((i * 89) % 380);
    out.push(`M${(cx + Math.cos(a) * r0).toFixed(1)},${(cy + Math.sin(a) * r0).toFixed(1)}L${(cx + Math.cos(a) * r1).toFixed(1)},${(cy + Math.sin(a) * r1).toFixed(1)}`);
  }
  return out.join("");
}

export function StageArt({ seed = 0 }: { seed?: number }) {
  const sparks: Array<[number, number, number]> = [[190, 110, 22], [1270, 140, 18], [520, 64, 24], [985, 330, 13], [330, 300, 15], [1150, 60, 12]];
  return (
    <svg className="stage__art" viewBox="0 0 1440 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <path d={rays()} stroke="#fff" strokeOpacity=".3" strokeWidth="1.1" transform={seed ? `rotate(${seed * 6} 720 200)` : undefined} />
      {sparks.map(([x, y, r], i) => (
        <path key={i} d={starPath(x + ((seed * 37 * (i + 1)) % 60) - 30, y, r)} fill="none" stroke="#fff" strokeOpacity=".85" strokeWidth="1.2" />
      ))}
    </svg>
  );
}

/** 네 갈래 별 표식 (제목 앞, 목록 앞) */
export function Spark({ filled = false, color = "currentColor" }: { filled?: boolean; color?: string }) {
  return (
    <svg className="spark" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d={starPath(10, 10, 9)} fill={filled ? color : "none"} stroke={color} strokeWidth="1.3" />
    </svg>
  );
}
