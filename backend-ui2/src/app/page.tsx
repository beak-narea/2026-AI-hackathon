"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Stage, TiltCard } from "@/components/Stage";
import { Spark } from "@/components/StageArt";
import { useSession } from "@/components/session";

// 이 서비스가 푸는 문제 (기획 문서 "전제와 목표"·출처의 문제 정의를 세 줄로)
const PROBLEMS = [
  "AI로 제품을 만들기는 쉬워졌지만, 고객이 그 일을 정말 AI에 맡기고 싶어 하는지, 범용 AI가 곧 같은 일을 하지 않을지, 운영비를 감당할 수 있을지는 만들기 전에 알기 어렵습니다.",
  "설문 답과 칭찬은 실제 행동과 다르고, AI에게 아이디어를 물으면 듣기 좋은 말을 돌려주기 쉽습니다.",
  "그래서 많은 팀이 확인 없이 만들고, 틀렸다는 사실을 시간과 돈을 다 쓴 뒤에 알게 됩니다.",
];

const LOOP = [
  ["진단", "제품이 대신하려는 업무를 쪼개고, 범용 AI로 대체될 위험과 운영비를 계산합니다."],
  ["위험한 가정", "“이미 실패했다”고 가정해 이유를 뽑고, 팀이 서로 보지 않고 중요도를 매깁니다."],
  ["검증 기획서", "실험 방법, 실행 가이드, 필요한 표본 수, 몇 명이 나오면 무엇을 할지 적은 결정표를 PDF로 드립니다."],
  ["판정과 결정", "제출된 결과로 판정하고 다음 행동을 권합니다. 계속할지, 고칠지, 접을지는 팀이 정합니다."],
] as const;

const RULES = [
  ["점수를 매기지 않습니다", "AI는 아이디어를 채점하지 않습니다. 가정을 찾고, 근거를 정리하고, 확인할 방법을 제안합니다."],
  ["기준은 실험 전에", "목표값과 최소 허용치는 결과를 보기 전에 잠급니다. 잠근 뒤에는 바꿀 수 없습니다."],
  ["말보다 행동", "설문 답과 칭찬은 참고만 합니다. 시간, 노력, 돈을 건 행동만 판정에 씁니다."],
  ["모르면 모른다고", "표본이 모자라면 판정 보류로 둡니다. 억지로 결론을 내지 않습니다."],
] as const;

// 내릴 때마다 한 토픽씩 넘어가는 섹션
const SECTIONS = [
  { id: "top", label: "처음" },
  { id: "what", label: "하는 일" },
  { id: "problem", label: "풀려는 문제" },
  { id: "loop", label: "한 바퀴" },
  { id: "rules", label: "지키는 원칙" },
] as const;

export default function Intro() {
  const { session } = useSession();
  const start = session?.user ? "/projects/new" : "/login?next=/projects/new";
  const [current, setCurrent] = useState<string>("top");
  const root = useRef<HTMLDivElement>(null);

  // 화면에 들어온 섹션을 표시하고(오른쪽 점), 처음 들어올 때 내용을 띄운다
  useEffect(() => {
    const secs = Array.from(root.current?.querySelectorAll<HTMLElement>(".snap__sec") ?? []);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            if (e.intersectionRatio >= 0.5) setCurrent(e.target.id);
          }
        }
      },
      { threshold: [0.15, 0.5] },
    );
    secs.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);

  // 마우스 휠 한 번 = 한 섹션 (넓은 화면, 마우스·트랙패드). 섹션이 화면보다 길면 그 안에서는 평소처럼 내려간다.
  useEffect(() => {
    if (!window.matchMedia("(min-width: 901px) and (min-height: 621px) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const secs = () => Array.from(root.current?.querySelectorAll<HTMLElement>(".snap__sec") ?? []);
    const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bar-h")) || 52;
    let lockUntil = 0;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return; // 확대·가로 스크롤은 그대로
      const now = Date.now();
      if (now < lockUntil) {
        e.preventDefault(); // 넘어가는 중에 들어온 관성 스크롤은 무시
        return;
      }
      if (Math.abs(e.deltaY) < 4) return;
      const list = secs();
      const view = window.innerHeight;
      // 지금 화면 위쪽에 걸친 섹션
      const idx = list.findIndex((s) => s.getBoundingClientRect().bottom > bar + 8);
      const cur = list[idx];
      if (!cur) return;
      const r = cur.getBoundingClientRect();
      const down = e.deltaY > 0;
      // 섹션 안에 아직 볼 내용이 남았으면 평소처럼 스크롤
      if (down && r.bottom > view + 4) return;
      if (!down && r.top < bar - 4) return;
      const target = list[idx + (down ? 1 : -1)];
      if (!target) return;
      e.preventDefault();
      lockUntil = now + 900;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="snap" ref={root}>
      <nav className="snap__dots" aria-label="섹션 이동">
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" aria-label={s.label} aria-current={current === s.id ? "true" : undefined} onClick={() => go(s.id)}>
            <span>{s.label}</span>
          </button>
        ))}
      </nav>

      <section className="snap__sec snap__sec--stage is-in" id="top">
        <Stage
          crumb={<><b>검증실</b>AI 스타트업 검증 서비스</>}
          actions={<Link className="pill pill--go" href={start}>내 아이디어로 시작</Link>}
          aside={<span className="stage__note">판정은 실제로 돌린 실험 결과로만 냅니다</span>}
        >
          <TiltCard kicker="AI 스타트업 검증 서비스" title="만들기 전에, 확인부터" sub="틀리면 끝나는 가정을 찾고, 실험으로 확인하고, 결과로 판정합니다." />
        </Stage>
        <button type="button" className="snap__next" onClick={() => go("what")}>아래로</button>
      </section>

      <section className="snap__sec" id="what">
        <div className="snap__inner intro-copy" id="main">
          <div className="reveal">
            <p className="snap__kicker">하는 일</p>
            <h1>AI 제품을 만들기 전에, 틀리면 끝나는 가정부터 확인하세요.</h1>
          </div>
          <div className="reveal reveal--2">
            <p>
              아이디어를 넣으면 사업 모델을 정리하고, AI 제품이라서 생기는 위험한 가정을 뽑습니다. 그 가정을 확인할
              실험은 &ldquo;검증 실험 및 MVP 기획서&rdquo;로 드리고, 실험은 팀이 직접 돌립니다.
            </p>
            <p>결과를 제출 폼으로 보내면, 미리 잠근 기준으로 충족, 미달, 판정 보류 가운데 하나로 판정합니다.</p>
          </div>
        </div>
      </section>

      <section className="snap__sec" id="problem">
        <div className="snap__inner">
          <p className="snap__kicker reveal">풀려는 문제</p>
          <h2 className="snap__title reveal">왜 만들기 전에 확인해야 할까요</h2>
          <ol className="problems">
            {PROBLEMS.map((p, i) => (
              <li key={i} className={`reveal reveal--${i + 2}`}><b>{i + 1}</b><span>{p}</span></li>
            ))}
          </ol>
        </div>
      </section>

      <section className="snap__sec" id="loop">
        <div className="snap__inner">
          <p className="snap__kicker reveal">한 바퀴가 도는 순서</p>
          <h2 className="snap__title reveal">진단에서 결정까지 네 단계</h2>
          <div className="loop">
            {LOOP.map(([h, p], i) => (
              <div key={h} className={`reveal reveal--${i + 2}`}>
                <b>{i + 1}</b>
                <h3>{h}</h3>
                <p>{p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="snap__sec snap__sec--last" id="rules">
        <div className="snap__inner">
          <p className="snap__kicker reveal">지키는 원칙</p>
          <h2 className="snap__title reveal">판정은 행동으로, 기준은 먼저</h2>
          <ul className="rules">
            {RULES.map(([b, t], i) => (
              <li key={b} className={`reveal reveal--${i + 2}`}><Spark filled color="var(--stone)" /><b>{b}</b><span>{t}</span></li>
            ))}
          </ul>
          <div className="form-actions reveal reveal--5" style={{ marginTop: 28 }}>
            <Link className="pill pill--go" href={start}>내 아이디어로 시작</Link>
          </div>
        </div>
        <footer className="footer">
          검증실은 한국어로만 제공합니다. 업로드한 원자료는 식별 정보를 가명으로 바꾼 뒤 저장합니다.
        </footer>
      </section>
    </div>
  );
}
