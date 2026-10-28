"use client";
import Link from "next/link";
import { Stage, TiltCard } from "@/components/Stage";
import { Spark } from "@/components/StageArt";
import { useSession } from "@/components/session";

// 이 서비스가 푸는 문제 (기획 문서 "전제와 목표"·출처의 문제 정의를 세 줄로)
const PROBLEMS = [
  "AI로 제품을 만들기는 쉬워졌지만, 고객이 그 일을 정말 AI에 맡기고 싶어 하는지, 범용 AI가 곧 같은 일을 하지 않을지, 운영비를 감당할 수 있을지는 만들기 전에 알기 어렵습니다.",
  "설문 답과 칭찬은 실제 행동과 다르고, AI에게 아이디어를 물으면 듣기 좋은 말을 돌려주기 쉽습니다.",
  "그래서 많은 팀이 확인 없이 만들고, 틀렸다는 사실을 시간과 돈을 다 쓴 뒤에 알게 됩니다.",
];

export default function Intro() {
  const { session } = useSession();
  const start = session?.user ? "/projects/new" : "/login?next=/projects/new";

  return (
    <>
      <Stage
        crumb={<><b>검증실</b>AI 스타트업 검증 서비스</>}
        actions={<Link className="pill pill--go" href={start}>내 아이디어로 시작</Link>}
        aside={<span className="stage__note">판정은 실제로 돌린 실험 결과로만 냅니다</span>}
      >
        <TiltCard kicker="AI 스타트업 검증 서비스" title="만들기 전에, 확인부터" sub="틀리면 끝나는 가정을 찾고, 실험으로 확인하고, 결과로 판정합니다." />
      </Stage>

      <div className="intro-copy" id="main">
        <div>
          <h1>AI 제품을 만들기 전에, 틀리면 끝나는 가정부터 확인하세요.</h1>
        </div>
        <div>
          <p>
            아이디어를 넣으면 사업 모델을 정리하고, AI 제품이라서 생기는 위험한 가정을 뽑습니다. 그 가정을 확인할
            실험은 &ldquo;검증 실험 및 MVP 기획서&rdquo;로 드리고, 실험은 팀이 직접 돌립니다.
          </p>
          <p>결과를 제출 폼으로 보내면, 미리 잠근 기준으로 충족, 미달, 판정 보류 가운데 하나로 판정합니다.</p>
          <div className="form-actions">
            <Link className="pill pill--ink" href={start}>내 아이디어로 시작</Link>
          </div>
        </div>
      </div>

      <div className="work work--wide" style={{ paddingTop: 16 }}>
        <section className="section">
          <div className="section__head">
            <h2>풀려는 문제</h2>
          </div>
          <ol className="problems">
            {PROBLEMS.map((p, i) => (
              <li key={i}><b>{i + 1}</b><span>{p}</span></li>
            ))}
          </ol>
        </section>

        <section className="section">
          <div className="section__head">
            <h2>한 바퀴가 도는 순서</h2>
          </div>
          <div className="loop">
            <div>
              <b>1</b>
              <h3>진단</h3>
              <p>제품이 대신하려는 업무를 쪼개고, 범용 AI로 대체될 위험과 운영비를 계산합니다.</p>
            </div>
            <div>
              <b>2</b>
              <h3>위험한 가정</h3>
              <p>&ldquo;이미 실패했다&rdquo;고 가정해 이유를 뽑고, 팀이 서로 보지 않고 중요도를 매깁니다.</p>
            </div>
            <div>
              <b>3</b>
              <h3>검증 기획서</h3>
              <p>실험 방법, 실행 가이드, 필요한 표본 수, 몇 명이 나오면 무엇을 할지 적은 결정표를 PDF로 드립니다.</p>
            </div>
            <div>
              <b>4</b>
              <h3>판정과 결정</h3>
              <p>제출된 결과로 판정하고 다음 행동을 권합니다. 계속할지, 고칠지, 접을지는 팀이 정합니다.</p>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section__head">
            <h2>지키는 원칙</h2>
          </div>
          <ul className="rules">
            <li><Spark filled color="var(--stone)" /><b>점수를 매기지 않습니다</b><span>AI는 아이디어를 채점하지 않습니다. 가정을 찾고, 근거를 정리하고, 확인할 방법을 제안합니다.</span></li>
            <li><Spark filled color="var(--stone)" /><b>기준은 실험 전에</b><span>목표값과 최소 허용치는 결과를 보기 전에 잠급니다. 잠근 뒤에는 바꿀 수 없습니다.</span></li>
            <li><Spark filled color="var(--stone)" /><b>말보다 행동</b><span>설문 답과 칭찬은 참고만 합니다. 시간, 노력, 돈을 건 행동만 판정에 씁니다.</span></li>
            <li><Spark filled color="var(--stone)" /><b>모르면 모른다고</b><span>표본이 모자라면 판정 보류로 둡니다. 억지로 결론을 내지 않습니다.</span></li>
          </ul>
        </section>
      </div>
      <footer className="footer">
        검증실은 한국어로만 제공합니다. 업로드한 원자료는 식별 정보를 가명으로 바꾼 뒤 저장합니다.
      </footer>
    </>
  );
}
