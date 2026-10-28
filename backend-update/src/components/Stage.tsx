import type { ReactNode } from "react";
import { StageArt } from "./StageArt";

/** 화면마다 맨 위의 검은 무대. 가운데에는 그 화면에서 가장 중요한 것 하나만 둔다. */
export function Stage({
  crumb, topRight, children, actions, aside, short = false, seed,
}: {
  crumb?: ReactNode;
  topRight?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  aside?: ReactNode;
  short?: boolean;
  seed?: number;
}) {
  return (
    <section className={`stage${short ? " stage--short" : ""}`}>
      <StageArt seed={seed} />
      <div className="stage__top">
        <div className="stage__crumb">{crumb}</div>
        <div>{topRight}</div>
      </div>
      <div className="stage__center">{children}</div>
      <div className="stage__bottom">
        <div className="stage__actions">{actions}</div>
        <div className="stage__actions">{aside}</div>
      </div>
    </section>
  );
}

export function TiltCard({
  kicker, title, sub, children, flat = false,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
  flat?: boolean;
}) {
  return (
    <div className={`tilt${flat ? " tilt--flat" : ""}`}>
      {kicker ? <p className="tilt__kicker">{kicker}</p> : null}
      <h1 className="tilt__title">{title}</h1>
      {sub ? <p className="tilt__sub">{sub}</p> : null}
      {children ? <div className="tilt__rings">{children}</div> : null}
    </div>
  );
}
