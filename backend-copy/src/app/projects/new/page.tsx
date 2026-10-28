"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Stage, TiltCard } from "@/components/Stage";
import { api, useAction } from "@/lib/client/api";
import { ErrorNote, Field, Note, Segmented, toast } from "@/components/ui";
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

  // 한 번 만든 프로젝트와 올린 파일은 기억해 두고, 다시 누르면 남은 단계만 한다 (실패 후 재시도로 프로젝트가 두 개 생기지 않게)
  const [projectId, setProjectId] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<Record<string, string>>({});
  const create = useAction(async () => {
    setStep(0);
    let id = projectId;
    const body = { name, idea_text: idea, is_b2b: b2b === "b2b" };
    if (!id) {
      id = (await api<{ id: string }>("/api/projects", { body })).id;
      setProjectId(id);
    } else {
      // 재시도 전에 고친 이름·설명·고객 방식도 반영한다
      await api(`/api/projects/${id}`, { method: "PATCH", body });
    }
    setStep(1);
    const done = { ...uploaded };
    for (const f of Array.from(files ?? [])) {
      const key = `${f.name}:${f.size}:${f.lastModified}`;
      if (done[key]) continue;
      const form = new FormData();
      form.set("file", f);
      try {
        done[key] = (await api<{ path: string }>(`/api/projects/${id}/source-files`, { form })).path;
      } catch (e) {
        setUploaded(done);
        throw new Error(`${f.name}: ${(e as Error).message} (프로젝트는 만들어졌습니다. 파일을 빼거나 바꾼 뒤 다시 누르면 이어서 합니다)`);
      }
    }
    setUploaded(done);
    const paths = Array.from(files ?? []).map((f) => done[`${f.name}:${f.size}:${f.lastModified}`]).filter((x): x is string => !!x);
    setStep(2);
    try {
      await api(`/api/projects/${id}/business-models/extract`, {
        body: { text: idea || undefined, urls: url ? [url] : undefined, files: paths.length ? paths : undefined },
      });
    } catch (e) {
      // 프로젝트는 만들어졌으니 사업 모델 화면에서 다시 시도한다. 왜 비어 있는지는 알려 준다
      toast(`사업 모델 초안을 만들지 못했습니다: ${(e as Error).message}. 사업 모델 화면에서 다시 시도하세요.`, true);
    }
    router.push(`/projects/${id}/business-model`);
  });

  if (session && !session.user) {
    return (
      <div className="work work--wide"><main id="main">
        <Note tone="info"><p>프로젝트를 만들려면 <Link href="/login?next=/projects/new">로그인</Link>하세요.</p></Note>
      </main></div>
    );
  }

  if (session?.user && !session.terms.accepted) {
    return (
      <div className="work work--wide"><main id="main">
        <Note tone="info"><p>프로젝트를 만들기 전에 <Link href="/login?next=/projects/new">약관을 확인</Link>하세요. 약관이 바뀌면 한 번 더 확인합니다.</p></Note>
      </main></div>
    );
  }

  return (
    <>
      <Stage short crumb={<b>새 프로젝트</b>}>
        <TiltCard title={name || "새 아이디어"} />
      </Stage>
      <div className="work work--wide">
        <main id="main" style={{ maxWidth: 680 }}>
          <form className="panel panel--tilt" onSubmit={(e) => { e.preventDefault(); void create.run(); }}>
            <Field label="프로젝트 이름">
              <input className="input" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 세무사 사무실용 증빙 분류 AI" />
            </Field>
            <Field label="아이디어 설명" hint="누구의 어떤 일을 AI가 대신하는지, 지금은 어떻게 하는지">
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
            <Field label="피치덱이나 사진 (선택)" hint="PDF, PNG, JPEG (사진은 5장까지)">
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
