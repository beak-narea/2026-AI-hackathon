// 통합 테스트·로컬 데모용: supabase-js 쿼리 빌더 중 서비스 코드가 쓰는 부분만 PGlite 위에 흉내 낸다 (service role = RLS 우회).
// PostgREST 자체를 검증하는 것이 아니라, 서비스 로직(상태 전이, 판정 사슬, 잠금, 결정)을 실제 스키마·트리거 위에서 돌리기 위한 것이다.
import { STORAGE_KEY_RE } from "../storage/key";
import type { PGlite } from "@electric-sql/pglite";

type Filter = { sql: (p: Params) => string };
type Params = { values: unknown[]; add: (v: unknown, cast?: string) => string };

interface Meta {
  columns: Map<string, Map<string, string>>; // table → column → type
  fks: Array<{ from: string; fromCol: string; to: string; toCol: string }>;
  funcs: Map<string, { retset: boolean }>;
}

async function loadMeta(db: PGlite): Promise<Meta> {
  const cols = await db.query<{ table_name: string; column_name: string; type: string }>(`
    select c.relname as table_name, a.attname as column_name, format_type(a.atttypid, a.atttypmod) as type
      from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped`);
  const columns = new Map<string, Map<string, string>>();
  for (const r of cols.rows) {
    if (!columns.has(r.table_name)) columns.set(r.table_name, new Map());
    columns.get(r.table_name)!.set(r.column_name, r.type);
  }
  const fk = await db.query<{ from: string; from_col: string; to: string; to_col: string }>(`
    select cl.relname as "from", a.attname as from_col, cf.relname as "to", af.attname as to_col
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid join pg_class cf on cf.oid = c.confrelid
      join pg_namespace n on n.oid = cl.relnamespace
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
     where c.contype = 'f' and n.nspname = 'public'`);
  const fn = await db.query<{ proname: string; proretset: boolean }>(
    `select p.proname, p.proretset from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`,
  );
  return {
    columns,
    fks: fk.rows.map((r) => ({ from: r.from, fromCol: r.from_col, to: r.to, toCol: r.to_col })),
    funcs: new Map(fn.rows.map((r) => [r.proname, { retset: r.proretset }])),
  };
}

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const MAX_ROWS = 1000;

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

function toPgValue(v: unknown, type: string | undefined): unknown {
  if (v === null || v === undefined) return null;
  if (type === "jsonb" || type === "json") return JSON.stringify(v);
  if (type?.endsWith("[]") && Array.isArray(v)) return `{${v.map((x) => `"${String(x).replace(/"/g, '\\"')}"`).join(",")}}`;
  if (typeof v === "object" && !(v instanceof Date)) return JSON.stringify(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "boolean" || typeof v === "number") return type === undefined ? String(v) : v;
  return String(v);
}

class Query implements PromiseLike<{ data: any; error: any; count?: number | null }> {
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private columns = "*";
  private returning = false;
  private filters: Filter[] = [];
  private orders: string[] = [];
  private limitN: number | null = null;
  private offsetN = 0;
  private mode: "single" | "maybe" | null = null;
  private payload: Record<string, unknown>[] = [];
  private onConflict: string | null = null;
  private countHead = false;

  constructor(private db: PGlite, private meta: Meta, private table: string) {}

  select(columns = "*", opts?: { count?: string; head?: boolean }) {
    if (this.op === "select") this.columns = columns;
    else {
      this.returning = true;
      this.columns = columns;
    }
    if (opts?.head) this.countHead = true;
    return this;
  }
  insert(rows: Record<string, unknown> | Record<string, unknown>[]) {
    this.op = "insert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(rows: Record<string, unknown> | Record<string, unknown>[], opts?: { onConflict?: string }) {
    this.op = "upsert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.onConflict = opts?.onConflict ?? "id";
    return this;
  }
  update(values: Record<string, unknown>) {
    this.op = "update";
    this.payload = [values];
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  private colType(col: string) {
    return this.meta.columns.get(this.table)?.get(col);
  }
  eq(col: string, val: unknown) {
    this.filters.push({ sql: (p) => `t.${q(col)}::text = ${p.add(toPgValue(val, undefined))}::text` });
    return this;
  }
  private cmp(col: string, op: string, val: unknown) {
    const type = this.colType(col);
    const cast = type && !type.endsWith("[]") && type !== "jsonb" ? type : "text";
    this.filters.push({ sql: (p) => `t.${q(col)} ${op} ${p.add(toPgValue(val, undefined))}::${cast}` });
    return this;
  }
  gte(col: string, val: unknown) {
    return this.cmp(col, ">=", val);
  }
  gt(col: string, val: unknown) {
    return this.cmp(col, ">", val);
  }
  lte(col: string, val: unknown) {
    return this.cmp(col, "<=", val);
  }
  lt(col: string, val: unknown) {
    return this.cmp(col, "<", val);
  }
  neq(col: string, val: unknown) {
    this.filters.push({ sql: (p) => `t.${q(col)}::text is distinct from ${p.add(toPgValue(val, undefined))}::text` });
    return this;
  }
  is(col: string, val: null | boolean) {
    this.filters.push({ sql: () => `t.${q(col)} is ${val === null ? "null" : val ? "true" : "false"}` });
    return this;
  }
  not(col: string, op: string, val: unknown) {
    if (op !== "is" || val !== null) throw new Error(`fake: not ${op} 미지원`);
    this.filters.push({ sql: () => `t.${q(col)} is not null` });
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push({ sql: (p) => `t.${q(col)}::text = any(${p.add(toPgValue(vals.map(String), "text[]"))}::text[])` });
    return this;
  }
  or(expr: string) {
    const parts = expr.split(",").map((x) => {
      const [col, op, ...rest] = x.split(".");
      if (op !== "eq") throw new Error(`fake: or 연산 ${op} 미지원`);
      return { col: col!, val: rest.join(".") };
    });
    this.filters.push({ sql: (p) => `(${parts.map((x) => `t.${q(x.col)}::text = ${p.add(x.val)}::text`).join(" or ")})` });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    const nulls = opts?.nullsFirst === undefined ? "" : opts.nullsFirst ? " nulls first" : " nulls last";
    this.orders.push(`t.${q(col)} ${opts?.ascending === false ? "desc" : "asc"}${nulls}`);
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  range(from: number, to: number) {
    this.offsetN = from;
    this.limitN = to - from + 1;
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }

  private projection(table: string, alias: string, columns: string): string {
    return splitTop(columns)
      .map((item) => {
        const m = item.match(/^(\w+)(?:!(\w+))?\((.*)\)$/s);
        if (!m) return item === "*" ? `${alias}.*` : `${alias}.${q(item)}`;
        const [, rel, hint, inner] = m as unknown as [string, string, string | undefined, string];
        const sub = `s_${rel}`;
        // rel!제약이름(...) 형식이면 그 외래 키로 고른다
        const named = (f: Meta["fks"][number]) => !hint || `${f.from}_${f.fromCol}_fkey` === hint;
        const manyToOne = this.meta.fks.find((f) => f.from === table && f.to === rel && named(f));
        const oneToMany = this.meta.fks.find((f) => f.from === rel && f.to === table && named(f));
        if (manyToOne) {
          return `(select row_to_json(x) from (select ${this.projection(rel, sub, inner)} from public.${q(rel)} ${sub} where ${sub}.${q(manyToOne.toCol)} = ${alias}.${q(manyToOne.fromCol)}) x) as ${q(rel)}`;
        }
        if (oneToMany && inner.trim() === "count") {
          // PostgREST 집계 임베드: rel(count) → [{ count: N }]
          return `(select json_build_array(json_build_object('count', count(*))) from public.${q(rel)} ${sub} where ${sub}.${q(oneToMany.fromCol)} = ${alias}.${q(oneToMany.toCol)}) as ${q(rel)}`;
        }
        if (oneToMany) {
          return `(select coalesce(json_agg(x), '[]'::json) from (select ${this.projection(rel, sub, inner)} from public.${q(rel)} ${sub} where ${sub}.${q(oneToMany.fromCol)} = ${alias}.${q(oneToMany.toCol)}) x) as ${q(rel)}`;
        }
        throw new Error(`fake: 관계를 찾지 못했다 ${table} → ${rel}`);
      })
      .join(", ");
  }

  private async run(): Promise<{ data: any; error: any; count?: number | null }> {
    const values: unknown[] = [];
    const p: Params = {
      values,
      add: (v, cast) => {
        values.push(v);
        return `$${values.length}${cast ? `::${cast}` : ""}`;
      },
    };
    const where = this.filters.length ? ` where ${this.filters.map((f) => f.sql(p)).join(" and ")}` : "";
    const T = `public.${q(this.table)}`;
    let sql: string;
    if (this.op === "select") {
      if (this.countHead) {
        sql = `select count(*)::int as n from ${T} t${where}`;
        const r = await this.db.query<{ n: number }>(sql, values);
        return { data: null, error: null, count: r.rows[0]!.n };
      }
      sql = `select ${this.projection(this.table, "t", this.columns)} from ${T} t${where}`;
      if (this.orders.length) sql += ` order by ${this.orders.join(", ")}`;
      // 실제 Supabase(PostgREST)처럼 한 번에 최대 1000행만 돌려준다
      sql += ` limit ${Math.min(this.limitN ?? MAX_ROWS, MAX_ROWS)}`;
      if (this.offsetN) sql += ` offset ${this.offsetN}`;
    } else if (this.op === "insert" || this.op === "upsert") {
      const cols = [...new Set(this.payload.flatMap((r) => Object.keys(r).filter((k) => r[k] !== undefined)))];
      const rowsSql = this.payload
        .map((r) => `(${cols.map((c) => (r[c] === undefined ? "default" : p.add(toPgValue(r[c], this.colType(c)), this.colType(c)))).join(", ")})`)
        .join(", ");
      sql = `with t as (insert into ${T} (${cols.map(q).join(", ")}) values ${rowsSql}`;
      if (this.op === "upsert") {
        const conflict = this.onConflict!.split(",").map((c) => q(c.trim()));
        const updates = cols.filter((c) => !conflict.includes(q(c))).map((c) => `${q(c)} = excluded.${q(c)}`);
        sql += ` on conflict (${conflict.join(", ")}) do update set ${updates.join(", ")}`;
      }
      sql += ` returning *) select ${this.projection(this.table, "t", this.columns)} from t`;
    } else if (this.op === "update") {
      const sets = Object.entries(this.payload[0]!)
        .filter(([, v]) => v !== undefined)
        .map(([c, v]) => `${q(c)} = ${p.add(toPgValue(v, this.colType(c)), this.colType(c))}`);
      sql = `with t as (update ${T} t set ${sets.join(", ")}${where} returning t.*) select ${this.projection(this.table, "t", this.columns)} from t`;
    } else {
      sql = `with t as (delete from ${T} t${where} returning t.*) select ${this.projection(this.table, "t", this.columns)} from t`;
    }
    try {
      const r = await this.db.query<Record<string, unknown>>(sql, values);
      let data: any = this.op === "select" || this.returning ? r.rows : null;
      if (this.mode && Array.isArray(data)) {
        if (data.length > 1) return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${data.length} rows`, code: "PGRST116" } };
        if (data.length === 0) {
          return this.mode === "single" ? { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", details: "The result contains 0 rows", code: "PGRST116" } } : { data: null, error: null };
        }
        data = data[0];
      }
      return { data, error: null };
    } catch (e) {
      const err = e as { message: string; code?: string };
      return { data: null, error: { message: err.message, code: err.code } };
    }
  }

  then<A, B>(ok?: ((v: { data: any; error: any; count?: number | null }) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return this.run().then(ok, fail);
  }
}

export async function fakeSupabase(db: PGlite) {
  const meta = await loadMeta(db);
  const files = new Map<string, Blob>();
  return {
    from: (table: string) => new Query(db, meta, table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      const values: unknown[] = [];
      const argSql = Object.entries(args)
        .map(([k, v]) => {
          values.push(v);
          return `${k} => $${values.length}`;
        })
        .join(", ");
      try {
        const retset = meta.funcs.get(name)?.retset;
        if (retset) return { data: (await db.query(`select * from public.${name}(${argSql})`, values)).rows, error: null };
        const r = await db.query<{ v: unknown }>(`select public.${name}(${argSql}) as v`, values);
        return { data: r.rows[0]?.v ?? null, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message, code: (e as { code?: string }).code } };
      }
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: Blob, opts?: { upsert?: boolean }) => {
          // 실제 Supabase Storage처럼 ASCII가 아닌 경로와 덮어쓰기를 거절한다
          if (!STORAGE_KEY_RE.test(path) || path.includes("//")) return { data: null, error: { message: `Invalid key: ${path}`, statusCode: "400" } };
          if (!opts?.upsert && files.has(`${bucket}/${path}`)) return { data: null, error: { message: "The resource already exists", statusCode: "409" } };
          files.set(`${bucket}/${path}`, body);
          return { data: { path }, error: null };
        },
        download: async (path: string) => {
          const f = files.get(`${bucket}/${path}`);
          return f ? { data: f, error: null } : { data: null, error: { message: "없음" } };
        },
        remove: async (paths: string[]) => {
          for (const p of paths) files.delete(`${bucket}/${p}`);
          return { data: paths.map((name) => ({ name })), error: null };
        },
      }),
    },
    auth: {
      admin: {
        inviteUserByEmail: async () => ({ data: null, error: null }),
        deleteUser: async (id: string) => {
          try {
            await db.query(`delete from auth.users where id = $1`, [id]);
            return { data: null, error: null };
          } catch (e) {
            return { data: null, error: { message: (e as Error).message } };
          }
        },
      },
    },
    _files: files,
  };
}
