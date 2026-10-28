// 사용자가 준 주소로 나가는 요청(웹사이트 읽기, 연동 도구 호출)을 서버 내부망으로 보내지 않는다 (SSRF 방지).
// 주소를 확인한 뒤 다시 DNS를 푸는 틈(DNS rebinding)이 없도록, 연결 순간의 DNS 결과를 직접 검사한다.
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";

export class UnsafeUrlError extends Error {}

const V4_BLOCKS: Array<[string, number]> = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
];

const v4ToInt = (ip: string) => ip.split(".").reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;

function privateV4(ip: string): boolean {
  const n = v4ToInt(ip);
  return V4_BLOCKS.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (v4ToInt(base) & mask);
  });
}

/** 내부망·예약 주소인가 (IPv4, IPv6, IPv4 매핑 IPv6, NAT64 포함) */
export function isPrivateAddress(addr: string): boolean {
  const a = addr.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0]!;
  if (net.isIPv4(a)) return privateV4(a);
  if (!net.isIPv6(a)) return true; // 알 수 없는 형식은 막는다
  if (a === "::" || a === "::1") return true;
  // ::ffff:a.b.c.d, ::ffff:7f00:1, 64:ff9b::a.b.c.d 처럼 IPv4를 품은 주소
  const embedded = a.match(/(?:^::ffff:|^64:ff9b::|^::)(\d+\.\d+\.\d+\.\d+)$/);
  if (embedded) return privateV4(embedded[1]!);
  const hexMapped = a.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1]!, 16);
    const lo = parseInt(hexMapped[2]!, 16);
    return privateV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (a.startsWith("64:ff9b:")) return true;
  const first = parseInt(a.split(":")[0] || "0", 16);
  return (first & 0xfe00) === 0xfc00 /* fc00::/7 */ || (first & 0xffc0) === 0xfe80 /* fe80::/10 */ || (first & 0xff00) === 0xff00 /* 멀티캐스트 */;
}

/** 프로토콜·호스트 모양 검사 (실제 IP 검사는 연결할 때 한다) */
export function assertPublicUrl(raw: string, opts: { allowHttp?: boolean } = {}): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError(`URL 형식이 아니다: ${raw}`);
  }
  if (url.protocol !== "https:" && !(opts.allowHttp && url.protocol === "http:")) {
    throw new UnsafeUrlError(opts.allowHttp ? "http(s) 주소만 받는다" : "https 주소만 받는다");
  }
  if (url.username || url.password) throw new UnsafeUrlError("주소에 계정 정보를 넣을 수 없다");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local") || !host.includes(".") && !net.isIP(host.replace(/^\[|\]$/g, ""))) {
    throw new UnsafeUrlError("내부 주소는 쓸 수 없다");
  }
  const literal = host.replace(/^\[|\]$/g, "");
  if (net.isIP(literal) && isPrivateAddress(literal)) throw new UnsafeUrlError("내부 주소는 쓸 수 없다");
  return url;
}

export const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...(options as dns.LookupOptions), all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = addresses as dns.LookupAddress[];
    const bad = list.find((x) => isPrivateAddress(x.address));
    if (bad || !list.length) return callback(new UnsafeUrlError("내부 주소로 연결된다"), "", 4);
    if ((options as dns.LookupOptions).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
};

export interface SafeResponse {
  status: number;
  ok: boolean;
  headers: http.IncomingHttpHeaders;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}

export interface SafeInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** 응답 본문 최대 바이트 (넘으면 잘라 읽는다) */
  maxBytes?: number;
  allowHttp?: boolean;
}

/** 리다이렉트를 따라가지 않는다 (호출 쪽이 Location을 다시 검사해 따라간다) */
export function safeFetch(raw: string, init: SafeInit = {}): Promise<SafeResponse> {
  const url = assertPublicUrl(raw, { allowHttp: init.allowHttp });
  const mod = url.protocol === "https:" ? https : http;
  const maxBytes = init.maxBytes ?? 5_000_000;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      url,
      { method: init.method ?? "GET", headers: init.headers, lookup: safeLookup, timeout: init.timeoutMs ?? 30_000 },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          if (size >= maxBytes) return;
          size += c.length;
          chunks.push(size > maxBytes ? c.subarray(0, c.length - (size - maxBytes)) : c);
          if (size >= maxBytes) res.destroy();
        });
        const done = () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          resolve({
            status,
            ok: status >= 200 && status < 300,
            headers: res.headers,
            text: async () => body,
            json: async <T,>() => JSON.parse(body) as T,
          });
        };
        res.on("end", done);
        res.on("close", done);
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("시간 초과")));
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}
