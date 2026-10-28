// WORKBank 업무 데이터를 workbank_tasks 테이블에 넣는다 (비상업적 용도, 출처: Shao et al., "Future of Work with AI Agents").
// 유료 판매를 시작하기 전에 저자에게 상업적 사용 허락을 받는다 (결정 사항 4번).
//
// 사용법:
//   npm run workbank:import                  (Hugging Face에서 노동자 자동화 희망 CSV를 내려받아 넣는다)
//   npm run workbank:import -- <csv 경로>     (내려받은 파일로)
//   옵션: --task 열이름 --occupation 열이름 --desire 열이름 --replace(기존 행을 지우고 다시)
//   필요한 환경 변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VOYAGE_API_KEY
import "./_env";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { embed, toPgVector } from "../src/lib/llm/embeddings";

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1]! : fallback;
}

const HF_URL = "https://huggingface.co/datasets/SALT-NLP/WORKBank/resolve/main/worker_data/domain_worker_desires.csv";

async function main() {
  const file = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;
  let text: string;
  if (file) text = readFileSync(file, "utf8");
  else {
    console.log(`내려받는 중: ${HF_URL}`);
    const res = await fetch(HF_URL, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`내려받기 실패 ${res.status}. 브라우저로 받아 경로를 넘긴다: npm run workbank:import -- <csv>`);
    text = await res.text();
  }
  if (!process.env.VOYAGE_API_KEY) throw new Error("VOYAGE_API_KEY가 필요하다");
  const [header, ...rows] = parseCsv(text.replace(/^\uFEFF/, ""));
  const col = (name: string) => {
    const idx = header!.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
    if (idx < 0) throw new Error(`열을 찾지 못했다: ${name} (있는 열: ${header!.join(", ")})`);
    return idx;
  };
  const taskIdx = col(arg("task", "Task"));
  const occIdx = col(arg("occupation", "Occupation (O*NET-SOC Title)"));
  const desireIdx = col(arg("desire", "Automation Desire Rating"));
  const agencyIdx = header!.findIndex((h) => /agency/i.test(h));

  // 같은 업무의 여러 응답은 평균낸다
  const byTask = new Map<string, { occupation: string; sum: number; n: number; agency: number[] }>();
  for (const r of rows) {
    const task = r[taskIdx]?.trim();
    const v = Number(r[desireIdx]);
    if (!task || Number.isNaN(v)) continue;
    const e = byTask.get(task) ?? { occupation: r[occIdx]?.trim() ?? "", sum: 0, n: 0, agency: [] };
    e.sum += v; e.n += 1;
    const a = agencyIdx >= 0 ? Number(String(r[agencyIdx] ?? "").replace(/[^0-9.]/g, "")) : NaN;
    if (a >= 1 && a <= 5) e.agency.push(a);
    byTask.set(task, e);
  }
  const items = [...byTask.entries()].map(([task, e]) => ({
    task,
    occupation: e.occupation,
    desire: e.sum / e.n,
    agency: e.agency.length ? `H${Math.round(e.agency.reduce((a, b) => a + b, 0) / e.agency.length)}` : null,
  }));
  console.log(`업무 ${items.length}개`);

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { count } = await db.from("workbank_tasks").select("id", { count: "exact", head: true });
  if ((count ?? 0) > 0) {
    if (!process.argv.includes("--replace")) {
      console.log(`이미 ${count}개가 있다. 다시 넣으려면 --replace`);
      return;
    }
    const { error } = await db.from("workbank_tasks").delete().gte("id", 0);
    if (error) throw error;
  }
  for (let i = 0; i < items.length; i += 64) {
    const batch = items.slice(i, i + 64);
    const vectors = await embed(batch.map((b) => b.task), process.env.VOYAGE_API_KEY, process.env.VOYAGE_MODEL ?? "voyage-3.5", "document");
    if (!vectors) throw new Error("VOYAGE_API_KEY가 필요하다");
    const { error } = await db.from("workbank_tasks").insert(
      batch.map((b, j) => ({ occupation: b.occupation, task_statement: b.task, automation_desire: b.desire, human_agency: b.agency, embedding: toPgVector(vectors[j]!) })),
    );
    if (error) throw error;
    console.log(`${Math.min(i + 64, items.length)} / ${items.length}`);
  }
  console.log("완료. 출처: Shao et al., Future of Work with AI Agents (WORKBank). 비상업적 용도, 유료 판매 전 저자 허락 필요.");
}

main().catch((e) => { console.error(e); process.exit(1); });
