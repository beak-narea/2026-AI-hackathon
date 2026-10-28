import { BRAND, LOGO, MARK } from "@/lib/brand";

/** Loopit 글자 로고. 색은 글자색(currentColor)을 따른다 */
export function Logo({ height = 24, title = BRAND, className }: { height?: number; title?: string | null; className?: string }) {
  return (
    <svg
      className={className}
      viewBox={`0 0 ${LOGO.width} ${LOGO.height}`}
      height={height}
      width={(height * LOGO.width) / LOGO.height}
      role={title ? "img" : undefined}
      aria-label={title ?? undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <path fill="currentColor" fillRule="evenodd" d={LOGO.d} />
    </svg>
  );
}

/** 무한 고리 표시만 */
export function LogoMark({ height = 20, className }: { height?: number; className?: string }) {
  return (
    <svg className={className} viewBox={`0 0 ${MARK.width} ${MARK.height}`} height={height} width={(height * MARK.width) / MARK.height} aria-hidden="true" focusable="false">
      <path fill="currentColor" fillRule="evenodd" d={MARK.d} />
    </svg>
  );
}
