"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";
import { useApi } from "@/lib/client/api";
import { useSession } from "./session";
import { ErrorNote } from "./ui";

export interface ProjectInfo {
  project: { id: string; name: string; idea_text: string; is_example: boolean; is_b2b: boolean; status: string; review_cycle_weeks?: number; raw_retention_days?: number };
  my_role: "owner" | "member" | "external_rater" | null;
  hypothesis_status_counts: Record<string, number>;
  pending_proposals: Array<{ id: string; hypothesis_id: string; method: string; status: string; look_number: number; sample_size: number | null }>;
  recent_verdicts: Array<{ id: string; hypothesis_id: string; result: string; look_number: number; n: number; successes: number; evidence_level: string; created_at: string }>;
  next_actions: Array<{ action: string; label: string; target?: string }>;
  cycle?: { review_cycle_weeks: number; last_reviewed_at: string | null; next_review_at: string; overdue: boolean; days_left: number };
  warnings?: Array<{ kind: string; severity: "high" | "mid"; message: string; target?: string; screen: string }>;
}

const ProjectCtx = createContext<{ info: ProjectInfo | null; canEdit: boolean; canRate: boolean; reload: () => Promise<void> }>({
  info: null, canEdit: false, canRate: false, reload: async () => {},
});
export const useProject = () => useContext(ProjectCtx);

const NAV: Array<{ group?: string; items: Array<[string, string]> }> = [
  { items: [["", "대시보드"]] },
  { group: "만들기 전", items: [["/business-model", "사업 모델"], ["/diagnosis", "진단"], ["/hypotheses", "가설"]] },
  { group: "검증", items: [["/proposals", "검증 제안"], ["/results", "결과 수령"], ["/verdicts", "결과 판정"], ["/decisions", "의사결정"]] },
  { group: "출시 후", items: [["/post-launch", "출시 후 측정"], ["/data", "데이터 연결"]] },
  { group: "프로젝트", items: [["/settings", "프로젝트 설정"], ["/files", "원자료"]] },
];

function SideNav({ projectId }: { projectId: string }) {
  const path = usePathname();
  const base = `/projects/${projectId}`;
  return (
    <nav className="side" aria-label="프로젝트 메뉴">
      {NAV.map((g, i) => (
        <div key={i} style={{ display: "contents" }}>
          {g.group ? <h3>{g.group}</h3> : null}
          {g.items.map(([href, label]) => {
            const full = base + href;
            const current = href === "" ? path === base : path.startsWith(full);
            return (
              <Link key={href} href={full} aria-current={current ? "page" : undefined}>
                {label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** 프로젝트 화면 공통 틀: 예시 표시 → 무대 → 사이드 메뉴 + 본문 */
export function ProjectShell({ projectId, stage, children }: { projectId: string; stage: (info: ProjectInfo | null) => ReactNode; children: ReactNode }) {
  const { session } = useSession();
  const { data, error, reload } = useApi<ProjectInfo>(`/api/projects/${projectId}`);
  const canEdit = !!data && !data.project.is_example && (data.my_role === "owner" || data.my_role === "member") && !!session?.user;
  const canRate = !!data && !data.project.is_example && !!data.my_role && !!session?.user;
  return (
    <ProjectCtx.Provider value={{ info: data, canEdit, canRate, reload }}>
      {data?.project.is_example ? (
        <div className="banner-example">예시 프로젝트입니다. 가상 사례이며 읽기만 할 수 있습니다.</div>
      ) : null}
      {data?.project.status === "archived" ? <div className="banner-example">보관함에 있는 프로젝트입니다.</div> : null}
      {stage(data)}
      <div className="work">
        <SideNav projectId={projectId} />
        <main id="main">
          {error ? <ErrorNote error={error} /> : children}
        </main>
      </div>
    </ProjectCtx.Provider>
  );
}

/** 편집 권한이 없을 때 버튼 대신 보여줄 안내 */
export function ReadOnlyHint() {
  const { info, canEdit } = useProject();
  const { session } = useSession();
  if (canEdit || !info || !session) return null;
  if (info.project.is_example) return <p className="small muted">예시 프로젝트라 바꿀 수 없습니다. 내 프로젝트를 만들면 같은 흐름을 직접 해 볼 수 있습니다.</p>;
  if (!session?.user) return <p className="small muted"><Link href="/login">로그인</Link>하면 편집할 수 있습니다.</p>;
  return <p className="small muted">외부 평가자는 중요도만 매길 수 있습니다.</p>;
}
