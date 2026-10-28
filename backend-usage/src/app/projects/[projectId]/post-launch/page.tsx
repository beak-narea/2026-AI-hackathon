import { redirect } from "next/navigation";

// 출시 후 측정은 검증 흐름(실사용 지표 기획서)으로 합쳤다. 예전 알림·북마크 주소는 기획서로 보낸다.
export default async function PostLaunchMoved({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  redirect(`/projects/${projectId}/proposals`);
}
