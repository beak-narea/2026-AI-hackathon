// 스크립트용 환경 변수 읽기: .env.local → .env 순서 (이미 설정된 값은 덮어쓰지 않는다)
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

for (const name of [".env.local", ".env"]) {
  const file = path.resolve(process.cwd(), name);
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2]!;
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]!] === undefined && v !== "") process.env[m[1]!] = v;
  }
}
