// 비식별 처리: 업로드 단계에서 식별자를 찾아 가명으로 바꾼다.
// 원자료와 가명 키는 분리 보관한다 (키는 private.pseudonym_keys, service role만 접근).
// 자동 탐지는 완전하지 않다. 결과 제출 폼에서 받은 참여자·회사 이름 목록을 함께 넣어 정확도를 높인다.

export type PiiKind = "email" | "phone" | "rrn" | "bizno" | "card" | "url" | "name" | "company";

export interface PseudonymEntry {
  token: string;
  original: string;
  kind: PiiKind;
}

export interface PseudonymizeOptions {
  /** 같은 프로젝트에서 이미 쓴 매핑 (같은 사람은 같은 가명) */
  existing?: PseudonymEntry[];
  /** 제출 폼에서 받은 참여자 이름 */
  knownNames?: string[];
  /** 제출 폼에서 받은 회사 이름 */
  knownCompanies?: string[];
  /** 호칭 앞의 2~4글자 한글을 이름 후보로 잡는다 (예: 김민수 대리) */
  detectHonorificNames?: boolean;
}

export interface PseudonymizeResult {
  text: string;
  entries: PseudonymEntry[];
  /** 이번에 새로 만든 매핑 (저장 대상) */
  added: PseudonymEntry[];
  counts: Partial<Record<PiiKind, number>>;
}

const TOKEN_LABEL: Record<PiiKind, string> = {
  email: "이메일", phone: "전화", rrn: "주민번호", bizno: "사업자번호", card: "카드", url: "링크", name: "이름", company: "회사",
};

const PATTERNS: Array<{ kind: PiiKind; re: RegExp }> = [
  { kind: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: "rrn", re: /\b\d{6}\s?-\s?[1-8]\d{6}\b/g },
  { kind: "card", re: /\b(?:\d{4}[- ]){3}\d{4}\b/g },
  { kind: "bizno", re: /\b\d{3}-\d{2}-\d{5}\b/g },
  { kind: "phone", re: /(?:\+82[- ]?|0)(?:1[016789]|2|[3-6][1-5]|70)[- ]?\d{3,4}[- ]?\d{4}\b/g },
  { kind: "url", re: /\bhttps?:\/\/[^\s<>"']+/g },
];

const HONORIFICS = "님|씨|대표님?|이사님?|부장님?|팀장님?|과장님?|대리님?|주임님?|사원|세무사님?|원장님?|선생님|교수님?|매니저님?|실장님?";
// 호칭 뒤에는 조사(은·는·이·가 등)나 한글이 아닌 글자가 온다
const HONORIFIC_NAME = new RegExp(
  `(?<![가-힣])([가-힣]{2,4})(?=\\s?(?:${HONORIFICS})(?:[은는이가을를의께도와과에랑]|[^가-힣]|$))`,
  "g",
);
// 호칭 앞에 와도 이름이 아닌 흔한 말
const NOT_NAMES = new Set(["고객", "사장", "직원", "담당", "회원", "여러분", "선생", "대표", "실무", "사용자", "팀원", "우리"]);

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function pseudonymize(input: string, opts: PseudonymizeOptions = {}): PseudonymizeResult {
  const entries: PseudonymEntry[] = [...(opts.existing ?? [])];
  const added: PseudonymEntry[] = [];
  const counts: Partial<Record<PiiKind, number>> = {};
  const byOriginal = new Map(entries.map((e) => [`${e.kind}:${e.original}`, e]));
  const nextIndex = (kind: PiiKind) => entries.filter((e) => e.kind === kind).length + 1;

  const tokenFor = (kind: PiiKind, original: string): string => {
    const key = `${kind}:${original}`;
    let e = byOriginal.get(key);
    if (!e) {
      e = { kind, original, token: `[${TOKEN_LABEL[kind]}${nextIndex(kind)}]` };
      entries.push(e);
      added.push(e);
      byOriginal.set(key, e);
    }
    counts[kind] = (counts[kind] ?? 0) + 1;
    return e.token;
  };

  let text = input.normalize("NFC");

  // 1) 알려진 회사·이름 (긴 것부터 바꿔 부분 일치를 막는다)
  const known: Array<{ kind: PiiKind; value: string }> = [
    ...(opts.knownCompanies ?? []).map((value) => ({ kind: "company" as const, value })),
    ...(opts.knownNames ?? []).map((value) => ({ kind: "name" as const, value })),
    // 이전에 가명 처리한 이름·회사는 호칭이 없어도 다시 찾는다
    ...entries
      .filter((e) => e.kind === "name" || e.kind === "company")
      .map((e) => ({ kind: e.kind, value: e.original })),
  ]
    .filter((k) => k.value.trim().length >= 2)
    .sort((a, b) => b.value.length - a.value.length);
  for (const k of known) {
    text = text.replace(new RegExp(escapeRegExp(k.value.trim()), "g"), (m) => tokenFor(k.kind, m));
  }

  // 2) 형식이 정해진 식별자
  for (const { kind, re } of PATTERNS) {
    text = text.replace(re, (m) => tokenFor(kind, m));
  }

  // 3) 호칭 앞 이름 후보
  if (opts.detectHonorificNames ?? true) {
    text = text.replace(HONORIFIC_NAME, (m, name: string) => {
      if (NOT_NAMES.has(name) || name.startsWith("[")) return m;
      return tokenFor("name", name);
    });
  }

  return { text, entries, added, counts };
}
