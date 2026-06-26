const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const JWT_RE = /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const PHONE_RE = /\+?[1-9]\d{7,14}/g;
const CARD_RE = /\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}/g;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;

const SENSITIVE_KEYS = /^(token|access_token|refresh_token|api_key|apikey|secret|password|passwd|session|sessionid|cookie|authorization|auth|jwt|ssn|social_security)$/i;

export function maskValue(value: string): string {
  if (JWT_RE.test(value)) return "[JWT_TOKEN]";
  if (BEARER_RE.test(value)) return "[TOKEN]";

  let masked = value;
  masked = masked.replace(EMAIL_RE, "***@***.***");
  masked = masked.replace(CARD_RE, "[CARD]");
  masked = masked.replace(PHONE_RE, (match) => {
    if (match.length >= 8) return "[PHONE]";
    return match;
  });

  return masked;
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.test(key);
}
