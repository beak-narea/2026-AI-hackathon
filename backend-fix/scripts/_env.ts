// 스크립트용 환경 변수 읽기: .env.local → .env 순서. 이미 값이 있으면 덮어쓰지 않는다 (빈 값은 없는 것으로 본다).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

for (const name of [".env.local", ".env"]) {
  const file = path.resolve(process.cwd(), name);
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2]!.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    } else {
      // 따옴표 없는 값의 줄 끝 주석 ( # ...) 은 뺀다
      v = v.replace(/\s+#.*$/, "").trim();
    }
    const cur = process.env[m[1]!];
    if ((cur === undefined || cur.trim() === "") && v !== "") process.env[m[1]!] = v;
  }
}

/** 필요한 환경 변수가 없으면 무엇을 넣어야 하는지 알려 주고 끝낸다 */
export function requireEnv(...keys: string[]): void {
  const missing = keys.filter((k) => !process.env[k]?.trim());
  if (missing.length) {
    console.error(`✗ 환경 변수가 없다: ${missing.join(", ")} (.env.local에 넣는다. .env.example 참고)`);
    process.exit(1);
  }
}
