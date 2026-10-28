// 화면 양쪽 아래에 고정된 회갈색 선화 구름. 겹친 원을 채우고 테두리와 안쪽 호를 그어 선화 느낌을 낸다. (원래 그림)
import { starPath } from "./StageArt";

type Circle = [number, number, number];

function Cloud({ circles, sparks, side }: { circles: Circle[]; sparks: Array<[number, number, number]>; side: "l" | "r" }) {
  return (
    <svg className={`scene__${side}`} viewBox="0 0 300 380" aria-hidden="true" focusable="false">
      {circles.map(([x, y, r], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={r} fill="var(--stone)" stroke="#000" strokeWidth="1.5" />
          <path d={`M${x - r * 0.74},${y + r * 0.12} A${r * 0.8},${r * 0.8} 0 0 1 ${x + r * 0.52},${y - r * 0.44}`} fill="none" stroke="#000" strokeWidth="1" opacity=".5" />
        </g>
      ))}
      {sparks.map(([x, y, r], i) => <path key={i} d={starPath(x, y, r)} fill="#000" />)}
    </svg>
  );
}

const LEFT: Circle[] = [[40, 300, 140], [185, 300, 80], [255, 352, 58], [110, 372, 100], [-30, 190, 100], [190, 228, 44], [292, 392, 40]];
const mirror = (cs: Circle[]): Circle[] => cs.map(([x, y, r]) => [300 - x, y, r]);

export function SceneArt({ foot = false }: { foot?: boolean }) {
  return (
    <div className={foot ? "scene-foot" : "scene"} aria-hidden="true">
      <Cloud side="l" circles={LEFT} sparks={[[64, 205, 20], [228, 300, 15]]} />
      <Cloud side="r" circles={mirror(LEFT)} sparks={[[240, 210, 18], [74, 305, 14]]} />
    </div>
  );
}
