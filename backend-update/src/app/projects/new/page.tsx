"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Stage, TiltCard } from "@/components/Stage";
import { api, useAction } from "@/lib/client/api";
import { ErrorNote, Field, Note, Segmented } from "@/components/ui";
import { useSession } from "@/components/session";
import Link from "next/link";

const STEPS = ["프로젝트 만들기", "자료 올리기", "사업 모델 정리 (1분 정도)"];

export default function NewProject() {
  const router = useRouter();
  const { session } = useSession();
  const [name, setName] = useState("");
  const [idea, setIdea] = useState("");
  const [b2b, setB2b] = useState<"b2b" | "traffic">("traffic");
  const [url, setUrl] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [step, setStep] = useState(-1);

  const create = useAction(async () => {
    setStep(0);
    const project = await api<{ id: string }>("/api/projects", { body: { name, idea_text: idea, is_b2b: b2b === "b2b" } });
    setStep(1);
    const paths: string[] = [];
    for (const f of Array.from(files ?? [])) {
      const form = new FormData();
      form.set("file", f);
      paths.push((await api<{ path: string }>(`/api/projects/${project.id}/source-files`, { form })).path);
    }
    setStep(2);
    try {
      await api(`/api/projects/${project.id}/business-models/extract`, {
        body: { text: idea || undefined, urls: url ? [url] : undefined, files: paths.length ? paths : undefined },
      });
    } catch {
      // 프로젝트는 만들어졌으니 사업 모델 화면에서 다시 시도한다
    }
    router.push(`/projects/${project.id}/business-model`);
  });

  if (session && !session.user) {
    return (
      <div className="work work--wide"><main id="main">
        <Note tone="info"><p>프로젝트를 만들려면 <Link href="/login?next=/projects/new">로그인</Link>하세요.</p></Note>
      </main></div>
    );
  }

  return (
    <>
      <Stage short crumb={<b>새 프로젝트</b>}>
        <TiltCard title={name || "새 아이디어"} sub="아이디어 하나를 넣으면 사업 모델과 대신할 업무 목록 초안을 만듭니다." />
      </Stage>
      <div className="work work--wide">
        <main id="main" style={{ maxWidth: 680 }}>
          <form className="panel panel--tilt" onSubmit={(e) => { e.preventDefault(); void create.run(); }}>
            <Field label="프로젝트 이름">
              <input className="input" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 세무사 사무실용 증빙 분류 AI" />
            </Field>
            <Field label="아이디어 설명" hint="누구의 어떤 일을 AI가 대신하는지, 지금 그 일을 어떻게 하는지 적으면 진단이 정확해집니다.">
              <textarea className="textarea" rows={6} value={idea} onChange={(e) => setIdea(e.target.value)} />
            </Field>
            <div className="field">
              <span>고객을 만나는 방식</span>
              <Segmented
                label="고객을 만나는 방식"
                value={b2b}
                onChange={setB2b}
                options={[{ value: "traffic", label: "방문자가 있다 (웹·앱)" }, { value: "b2b", label: "영업으로 만난다 (B2B)" }]}
              />
              <small>실험 방법이 달라집니다. 방문자가 적은 B2B 팀은 가짜 버튼 대신 후속 미팅이나 유료 파일럿으로 검증합니다.</small>
            </div>
            <Field label="웹사이트 (선택)">
              <input className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
            </Field>
            <Field label="피치덱이나 사진 (선택)" hint="PDF, PNG, JPEG. 사진은 5장까지 분석합니다.">
              <input className="input" type="file" multiple accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFiles(e.target.files)} />
            </Field>
            <ErrorNote error={create.error} />
            {step >= 0 && !create.error ? (
              <Note tone="info">
                {STEPS.map((s, i) => (
                  <p key={s} style={{ opacity: i <= step ? 1 : 0.4 }}>{i < step ? "완료" : i === step ? "진행 중" : "대기"}: {s}</p>
                ))}
              </Note>
            ) : null}
            <div className="form-actions">
              <button className="pill pill--ink" disabled={create.busy || !name || (!idea && !url && !files?.length)}>프로젝트 만들기</button>
            </div>
          </form>
        </main>
      </div>
    </>
  );
}
