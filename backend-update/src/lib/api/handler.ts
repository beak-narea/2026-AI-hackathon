// API 라우트 공통 처리: 인증, 프로젝트 권한, 입력 검증, 오류 형식.
// 오류 응답 형식: { "error": { "code": "...", "message": "한국어 설명", "details"?: ... } }
import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { User } from "@supabase/supabase-js";
import { adminClient, currentUser, type Db } from "../supabase/server";
import { LlmError } from "../llm/client";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "대상") => new ApiError(404, "not_found", `${what}을(를) 찾을 수 없다`);
export const forbidden = () => new ApiError(403, "forbidden", "이 프로젝트에 대한 권한이 없다");
export const conflict = (message: string, details?: unknown) => new ApiError(409, "conflict", message, details);
export const badRequest = (message: string, details?: unknown) => new ApiError(400, "bad_request", message, details);

export type ProjectRole = "owner" | "member" | "external_rater";

export interface Ctx<P> {
  req: Request;
  params: P;
  admin: Db;
  /** 로그인이 필요한 라우트에서는 항상 있다. auth: false 라우트에서는 비로그인이면 null */
  user: User;
}

type RouteContext<P> = { params: Promise<P> };

interface Options {
  /** false면 비로그인 허용 (예: 기준선 평가 링크, 예시 프로젝트) */
  auth?: boolean;
}

export function route<P = Record<string, never>>(
  fn: (ctx: Ctx<P>) => Promise<unknown>,
  opts: Options = {},
) {
  return async (req: Request, context: RouteContext<P>): Promise<Response> => {
    try {
      const params = (await context?.params) ?? ({} as P);
      // 로그인이 선택인 라우트도 로그인한 사용자는 알아본다 (멤버의 비공개 프로젝트 조회)
      const user: User | null = await currentUser(req);
      if (opts.auth !== false && !user) throw new ApiError(401, "unauthorized", "로그인이 필요하다");
      const admin = await adminClient();
      const result = await fn({ req, params, admin, user: user as User });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (e) {
      return toErrorResponse(e);
    }
  };
}

export function toErrorResponse(e: unknown): Response {
  if (e instanceof ApiError) {
    return NextResponse.json({ error: { code: e.code, message: e.message, details: e.details } }, { status: e.status });
  }
  if (e instanceof z.ZodError) {
    return NextResponse.json(
      { error: { code: "validation", message: "입력값이 올바르지 않다", details: z.flattenError(e) } },
      { status: 422 },
    );
  }
  if (e instanceof LlmError) {
    return NextResponse.json({ error: { code: "llm_failed", message: e.message } }, { status: 502 });
  }
  const pg = e as { code?: string; message?: string };
  if (pg?.code === "23514" || pg?.code === "P0001") {
    return NextResponse.json({ error: { code: "rule_violation", message: pg.message } }, { status: 409 });
  }
  if (e instanceof Error && e.message.startsWith("환경 변수")) {
    console.error("[api] config", e.message);
    return NextResponse.json({ error: { code: "misconfigured", message: "서버 설정이 끝나지 않았다" } }, { status: 503 });
  }
  console.error("[api] unexpected", e);
  return NextResponse.json({ error: { code: "internal", message: "서버 오류" } }, { status: 500 });
}

export async function body<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("JSON 본문이 필요하다");
  }
  return schema.parse(raw);
}

export function query<T>(req: Request, schema: z.ZodType<T>): T {
  const url = new URL(req.url);
  return schema.parse(Object.fromEntries(url.searchParams));
}

/** 프로젝트 역할 확인. 예시 프로젝트는 읽기만 된다. */
export async function projectRole(ctx: Ctx<unknown>, projectId: string): Promise<{ role: ProjectRole | null; isExample: boolean }> {
  const { data: project } = await ctx.admin.from("projects").select("id, owner_id, is_example").eq("id", projectId).maybeSingle();
  if (!project) throw notFound("프로젝트");
  if (project.owner_id && project.owner_id === ctx.user?.id) return { role: "owner", isExample: project.is_example };
  if (!ctx.user) return { role: null, isExample: project.is_example };
  const { data: m } = await ctx.admin
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  return { role: (m?.role as ProjectRole) ?? null, isExample: project.is_example };
}

export async function requireEditor(ctx: Ctx<unknown>, projectId: string): Promise<void> {
  const { role, isExample } = await projectRole(ctx, projectId);
  if (isExample) throw new ApiError(403, "example_read_only", "예시 프로젝트는 읽기 전용이다");
  if (role !== "owner" && role !== "member") throw forbidden();
}

export async function requireMember(ctx: Ctx<unknown>, projectId: string): Promise<ProjectRole> {
  const { role, isExample } = await projectRole(ctx, projectId);
  if (isExample) throw new ApiError(403, "example_read_only", "예시 프로젝트는 읽기 전용이다");
  if (!role) throw forbidden();
  return role;
}

export async function requireReader(ctx: Ctx<unknown>, projectId: string): Promise<void> {
  const { role, isExample } = await projectRole(ctx, projectId);
  if (isExample || role) return;
  if (!ctx.user) throw new ApiError(401, "unauthorized", "로그인이 필요하다");
  throw forbidden();
}

/** supabase 응답에서 오류를 던지고 데이터만 꺼낸다 */
export function must<T>(res: { data: T; error: { message: string; code?: string } | null }, what = "데이터"): NonNullable<T> {
  if (res.error) {
    const err = new Error(res.error.message) as Error & { code?: string };
    err.code = res.error.code;
    throw err;
  }
  if (res.data === null || res.data === undefined) throw notFound(what);
  return res.data as NonNullable<T>;
}

export const Uuid = z.string().uuid();
