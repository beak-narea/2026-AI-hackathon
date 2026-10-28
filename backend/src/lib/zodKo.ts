// 서버가 돌려주는 입력 오류 문구를 한국어로 (화면의 칸 옆에 그대로 보인다)
import { z } from "zod";

let done = false;
export function installKoreanZodErrors() {
  if (done) return;
  done = true;
  z.config(z.locales.ko());
  z.config({
    customError: (iss) => {
      const unit = (origin: unknown) => (origin === "string" ? "자" : origin === "array" || origin === "set" ? "개" : "");
      switch (iss.code) {
        case "too_big":
          return `${String(iss.maximum)}${unit(iss.origin)} 이하로 입력하세요`;
        case "too_small":
          return iss.origin === "string" && Number(iss.minimum) === 1 ? "비워 둘 수 없습니다" : `${String(iss.minimum)}${unit(iss.origin)} 이상으로 입력하세요`;
        case "invalid_type":
          return iss.input === undefined || iss.input === null ? "값이 필요합니다" : "형식이 올바르지 않습니다";
        case "invalid_format":
          return iss.format === "email" ? "메일 주소 형식이 아닙니다" : iss.format === "url" ? "주소(URL) 형식이 아닙니다" : iss.format === "datetime" ? "날짜·시각 형식이 아닙니다 (예: 2026-10-01T00:00:00+09:00)" : "형식이 올바르지 않습니다";
        case "invalid_value":
          return "고를 수 있는 값이 아닙니다";
        default:
          return undefined;
      }
    },
  });
}
