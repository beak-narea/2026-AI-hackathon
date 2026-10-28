import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource/noto-sans-kr/400.css";
import "@fontsource/noto-sans-kr/500.css";
import "@fontsource/noto-sans-kr/700.css";
import "@fontsource/noto-sans-kr/900.css";
import "@fontsource-variable/space-grotesk/wght.css";
import "./globals.css";
import { SessionProvider } from "@/components/session";
import { TopBar } from "@/components/TopBar";
import { Toaster } from "@/components/ui";
import { SceneArt } from "@/components/SceneArt";

export const metadata: Metadata = {
  title: { default: "Loopit", template: "%s | Loopit" },
  applicationName: "Loopit",
  description: "AI 제품 아이디어의 위험한 가정을 찾고, 검증 실험을 기획하고, 돌아온 결과로 판정합니다.",
};

export const viewport: Viewport = { themeColor: "#000000", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <SessionProvider>
          <a href="#main" className="sr-only">본문으로 건너뛰기</a>
          <SceneArt />
          <TopBar />
          <div className="page">{children}</div>
          <SceneArt foot />
          <Toaster />
        </SessionProvider>
      </body>
    </html>
  );
}
