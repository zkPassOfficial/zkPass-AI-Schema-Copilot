const MULTI_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk",
  "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn",
  "com.hk", "com.tw", "com.sg", "com.au", "net.au", "org.au",
  "co.jp", "ne.jp", "or.jp", "co.kr", "co.in",
  "com.br", "com.mx",
  "github.io", "gitlab.io", "vercel.app", "netlify.app", "pages.dev", "web.app", "firebaseapp.com",
]);

export function getBaseDomain(url: string): string {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return url;
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname === "localhost") {
    return hostname;
  }

  const parts = hostname.split(".");
  if (parts.length <= 2) return hostname;

  const lastTwo = parts.slice(-2).join(".");
  if (MULTI_PART_SUFFIXES.has(lastTwo)) {
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}
