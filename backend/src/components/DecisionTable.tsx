export interface TableRow { n: number; metFrom: number | null; holdFrom: number | null; holdTo: number | null; failTo: number | null }
export function DecisionTable({ rows, highlight }: { rows: TableRow[]; highlight?: number | null }) {
  return (
    <div className="table-wrap">
      <table className="t">
        <thead><tr><th>표본 수</th><th>충족</th><th>판정 보류</th><th>미달</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.n} className={highlight === r.n ? "hit" : undefined}>
              <td className="num">{r.n}명</td>
              <td className="met">{r.metFrom === null ? "이 표본으로는 불가" : `${r.metFrom}명 이상`}</td>
              <td className="hold">{r.holdFrom === null ? "없음" : r.holdFrom === r.holdTo ? `${r.holdFrom}명` : `${r.holdFrom}~${r.holdTo}명`}</td>
              <td className="not_met">{r.failTo === null ? "이 표본으로는 불가" : `${r.failTo}명 이하`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

