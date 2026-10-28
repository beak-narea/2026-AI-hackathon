import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 컨테이너 배포용: .next/standalone 에 서버 실행 파일만 모은다
  output: "standalone",
  // PDF 렌더러와 폰트 파일은 번들하지 않고 런타임에 읽는다
  serverExternalPackages: ["@react-pdf/renderer", "@electric-sql/pglite"],
  // PDF 라우트: 한국어 폰트와 pdfkit 기본 글꼴 파일(동적 require라 자동 추적이 안 된다)을 함께 싣는다
  outputFileTracingIncludes: {
    "/api/projects/[projectId]/proposals/[proposalId]/pdf": ["./assets/fonts/**", "./node_modules/pdfkit/js/**"],
  },
  poweredByHeader: false,
};

export default nextConfig;
