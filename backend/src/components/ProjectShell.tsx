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

// 메뉴는 다섯 묶음. 묶음 안의 화면은 본문 위의 작은 탭으로 오간다.
const SECTIONS: Array<{ label: string; tabs: Array<[string, string]> }> = [
  { label: "대시보드", tabs: [["", "대시보드"]] },
  { label: "아이디어 정리", tabs: [["/business-model", "사업 모델"], ["/diagnosis", "진단"]] },
  { label: "가설", tabs: [["/hypotheses", "가설"]] },
  { label: "검증", tabs: [["/proposals", "기획서"], ["/results", "결과 제출"], ["/verdicts", "판정"], ["/decisions", "결정"]] },
  { label: "설정", tabs: [["/settings", "프로젝트"], ["/files", "원자료"], ["/data", "데이터 연결"]] },
];

const isTab = (path: string, base: string, href: string) => (href === "" ? path === base : path === base + href || path.startsWith(`${base + href}/`));

function useSection(projectId: string) {
  const path = usePathname();
  const base = `/projects/${projectId}`;
  const section = SECTIONS.find((g) => g.tabs.some(([href]) => isTab(path, base, href))) ?? SECTIONS[0]!;
  return { path, base, section };
}

function SideNav({ projectId }: { projectId: string }) {
  const { base, section } = useSection(projectId);
  return (
    <nav className="side" aria-label="프로젝트 메뉴">
      {SECTIONS.map((g) => (
        <Link key={g.label} href={base + g.tabs[0]![0]} aria-current={g === section ? "page" : undefined}>
          {g.label}
        </Link>
      ))}
    </nav>
  );
}

/** 묶음 안의 화면이 둘 이상이면 본문 위에 작은 탭 */
function SubTabs({ projectId }: { projectId: string }) {
  const { path, base, section } = useSection(projectId);
  if (section.tabs.length < 2) return null;
  return (
    <nav className="subtabs" aria-label={`${section.label} 화면`}>
      {section.tabs.map(([href, label]) => (
        <Link key={href} href={base + href} aria-current={isTab(path, base, href) ? "page" : undefined}>
          {label}
        </Link>
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
          <SubTabs projectId={projectId} />
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
  if (info.project.is_example) return <p className="small muted">예시 프로젝트는 읽기만 할 수 있습니다.</p>;
  if (!session?.user) return <p className="small muted"><Link href="/login">로그인</Link>하면 편집할 수 있습니다.</p>;
  return <p className="small muted">외부 평가자는 중요도만 매길 수 있습니다.</p>;
}
