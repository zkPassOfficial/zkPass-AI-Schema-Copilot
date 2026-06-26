import type { CapturedRequest, IndexedField } from "@/shared/types";
import { MAX_RESPONSE_SIZE, MAX_HTML_SIZE, MAX_HTML_INDEX_FIELDS, MessageType } from "@/shared/constants";
import { storeCapturedRequest, getCaptureCount } from "./storage";
import { getBaseDomain } from "@/shared/domain";

interface PendingRequest {
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  tabId: number;
  type: string;
}

const pendingBodies = new Map<string, { body: string | null; url: string; method: string; tabId: number; type: string }>();
const pendingRequests = new Map<string, PendingRequest>();
const replayedUrls = new Map<number, Map<string, number>>();
const tabDomains = new Map<number, string>();
const tabUrls = new Map<number, string>();

const REPLAY_COOLDOWN_MS = 10_000;

// Stable id derived from method+url so the same endpoint keeps the same id
// across reloads — lets the AI reference prior selections from chat history.
function stableId(prefix: string, key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  return `${prefix}_${(h >>> 0).toString(36)}`;
}

export async function getTabDomain(tabId: number): Promise<string | null> {
  const cached = tabDomains.get(tabId);
  if (cached) return cached;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) return null;
    const domain = getBaseDomain(tab.url);
    tabDomains.set(tabId, domain);
    return domain;
  } catch {
    return null;
  }
}

async function getTabUrl(tabId: number): Promise<string | undefined> {
  const cached = tabUrls.get(tabId);
  if (cached) return cached;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) return undefined;
    tabUrls.set(tabId, tab.url);
    return tab.url;
  } catch {
    return undefined;
  }
}

function isJsonContentType(ct: string): boolean {
  return ct.includes("application/json") || ct.includes("+json");
}

function isHtmlContentType(ct: string): boolean {
  return ct.includes("text/html") || ct.includes("application/xhtml");
}

function shouldCapture(url: string, type: string): boolean {
  if (type === "image" || type === "font" || type === "stylesheet" || type === "media") return false;
  if (url.startsWith("chrome://") || url.startsWith("chrome-extension://")) return false;
  if (/\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ttf|eot|ico|map)(\?|$)/i.test(url)) return false;
  return true;
}

function headersToRecord(headers: chrome.webRequest.HttpHeader[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const h of headers) {
    if (h.value) record[h.name.toLowerCase()] = h.value;
  }
  return record;
}

const SKIP_REPLAY_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "accept-encoding",
  "cookie",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-user",
]);

function buildReplayHeaders(captured: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(captured)) {
    if (SKIP_REPLAY_HEADERS.has(key)) continue;
    headers[key] = value;
  }
  return headers;
}

function extractRequestBody(details: chrome.webRequest.WebRequestBodyDetails): string | null {
  const rb = details.requestBody;
  if (!rb) return null;

  if (rb.raw && rb.raw.length > 0) {
    const parts: string[] = [];
    for (const part of rb.raw) {
      if (part.bytes) {
        parts.push(new TextDecoder().decode(part.bytes));
      }
    }
    const joined = parts.join("");
    if (joined) return joined;
  }

  if (rb.formData) {
    const params = new URLSearchParams();
    for (const [key, values] of Object.entries(rb.formData)) {
      for (const v of values) {
        params.append(key, v);
      }
    }
    return params.toString();
  }

  return null;
}

function onBeforeRequest(details: chrome.webRequest.WebRequestBodyDetails): void {
  if (!details.tabId || details.tabId < 0) return;
  if (!shouldCapture(details.url, details.type)) return;

  pendingBodies.set(details.requestId, {
    body: extractRequestBody(details),
    url: details.url,
    method: details.method,
    tabId: details.tabId,
    type: details.type,
  });
}

function onBeforeSendHeaders(
  details: chrome.webRequest.WebRequestHeadersDetails
): void {
  const pending = pendingBodies.get(details.requestId);
  if (!pending) {
    if (!details.tabId || details.tabId < 0) return;
    if (!shouldCapture(details.url, details.type)) return;
  }

  const headers = details.requestHeaders || [];

  pendingRequests.set(details.requestId, {
    url: details.url,
    method: details.method,
    requestHeaders: headersToRecord(headers),
    requestBody: pending?.body ?? null,
    tabId: details.tabId,
    type: details.type,
  });

  pendingBodies.delete(details.requestId);
}

function notifyCaptureCount(tabId: number, domain: string): void {
  getCaptureCount(domain).then((count) => {
    chrome.runtime.sendMessage({
      type: MessageType.CAPTURE_COUNT_UPDATED,
      payload: { tabId, domain, count },
    }).catch(() => {});
  });
}

function onCompleted(details: chrome.webRequest.WebResponseCacheDetails): void {
  const pending = pendingRequests.get(details.requestId);
  if (!pending) return;
  pendingRequests.delete(details.requestId);

  const responseHeaders = headersToRecord(details.responseHeaders || []);
  const ct = responseHeaders["content-type"] || "";

  const isJson = isJsonContentType(ct);
  const isHtml = isHtmlContentType(ct);
  if (!isJson && !isHtml) return;
  if (details.statusCode < 200 || details.statusCode >= 400) return;

  const dedupeKey = `${pending.method}:${pending.url}:${pending.requestBody ?? ""}`;
  let tabMap = replayedUrls.get(pending.tabId);
  if (!tabMap) {
    tabMap = new Map();
    replayedUrls.set(pending.tabId, tabMap);
  }
  const lastSeen = tabMap.get(dedupeKey);
  if (lastSeen !== undefined && Date.now() - lastSeen < REPLAY_COOLDOWN_MS) return;
  tabMap.set(dedupeKey, Date.now());

  if (isHtml) {
    const id = stableId("doc", dedupeKey);
    replayAndStoreHtml(id, pending, details.statusCode, responseHeaders, ct);
  } else {
    const id = stableId("cap", dedupeKey);
    replayAndStore(id, pending, details.statusCode, responseHeaders, ct);
  }
}

async function replayAndStoreHtml(
  id: string,
  pending: PendingRequest,
  statusCode: number,
  responseHeaders: Record<string, string>,
  ct: string,
): Promise<void> {
  try {
    let body: string | null = null;

    if (pending.type === "main_frame") {
      const results = await chrome.scripting.executeScript({
        target: { tabId: pending.tabId },
        world: "MAIN",
        func: () => document.documentElement.outerHTML,
      });
      body = results?.[0]?.result ?? null;
    } else {
      body = await replayViaTabHtml(pending);
    }

    if (typeof body !== "string" || body.length < 100) return;

    const pageUrl = await getTabUrl(pending.tabId);
    const captured: CapturedRequest = {
      id,
      url: pending.url,
      method: pending.method,
      status: statusCode,
      requestHeaders: pending.requestHeaders,
      requestBody: pending.requestBody?.slice(0, 100_000) ?? null,
      responseHeaders,
      responseBody: body.slice(0, MAX_HTML_SIZE),
      contentType: ct,
      timestamp: Date.now(),
      tabId: pending.tabId,
      origin: new URL(pending.url).origin,
      sourceType: "html",
      pageUrl,
    };

    const domain = await getTabDomain(pending.tabId);
    if (!domain) return;
    await storeCapturedRequest(domain, captured);
    notifyCaptureCount(pending.tabId, domain);
  } catch {
    // silently skip
  }
}

async function replayAndStore(
  id: string,
  pending: PendingRequest,
  statusCode: number,
  responseHeaders: Record<string, string>,
  ct: string
): Promise<void> {
  try {
    const body = await replayViaTab(pending);
    if (!body) return;

    const pageUrl = await getTabUrl(pending.tabId);
    const captured: CapturedRequest = {
      id,
      url: pending.url,
      method: pending.method,
      status: statusCode,
      requestHeaders: pending.requestHeaders,
      requestBody: pending.requestBody?.slice(0, 100_000) ?? null,
      responseHeaders,
      responseBody: body,
      contentType: ct,
      timestamp: Date.now(),
      tabId: pending.tabId,
      origin: new URL(pending.url).origin,
      pageUrl,
    };

    const domain = await getTabDomain(pending.tabId);
    if (!domain) return;
    await storeCapturedRequest(domain, captured);
    notifyCaptureCount(pending.tabId, domain);
  } catch {
    // silently skip
  }
}

async function replayViaTab(pending: PendingRequest): Promise<string | null> {
  const headers = buildReplayHeaders(pending.requestHeaders);
  const isXhr = pending.type === "xmlhttprequest";

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: pending.tabId },
      world: "MAIN",
      func: replayInPage,
      args: [pending.url, pending.method, headers, pending.requestBody, isXhr, MAX_RESPONSE_SIZE],
    });

    const result = results?.[0]?.result;
    if (typeof result === "string" && result.length > 0) {
      return result;
    }
    return null;
  } catch {
    return null;
  }
}

async function replayViaTabHtml(pending: PendingRequest): Promise<string | null> {
  const headers = buildReplayHeaders(pending.requestHeaders);

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: pending.tabId },
      world: "MAIN",
      func: replayInPageHtml,
      args: [pending.url, pending.method, headers, pending.requestBody, MAX_HTML_SIZE],
    });

    const result = results?.[0]?.result;
    if (typeof result === "string" && result.length > 0) {
      return result;
    }
    return null;
  } catch {
    return null;
  }
}

function replayInPage(
  url: string,
  method: string,
  headers: Record<string, string>,
  requestBody: string | null,
  useXhr: boolean,
  maxSize: number,
): Promise<string | null> {
  function isJson(body: string): boolean {
    var t = body.trimStart();
    return t[0] === "{" || t[0] === "[";
  }

  if (useXhr) {
    return new Promise(function (resolve) {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open(method, url, true);
        var keys = Object.keys(headers);
        for (var i = 0; i < keys.length; i++) {
          try { xhr.setRequestHeader(keys[i], headers[keys[i]]); } catch { /* skip forbidden headers */ }
        }
        xhr.withCredentials = true;
        xhr.onload = function () {
          try {
            if (xhr.status < 200 || xhr.status >= 400) { resolve(null); return; }
            var body = xhr.responseText;
            if (!body || !isJson(body)) { resolve(null); return; }
            resolve(body.slice(0, maxSize));
          } catch { resolve(null); }
        };
        xhr.onerror = function () { resolve(null); };
        xhr.ontimeout = function () { resolve(null); };
        xhr.timeout = 15000;
        xhr.send(requestBody);
      } catch { resolve(null); }
    });
  }

  var fetchInit: RequestInit = {
    method: method,
    headers: headers,
    credentials: "include",
  };
  if (requestBody && method !== "GET" && method !== "HEAD") {
    fetchInit.body = requestBody;
  }
  return fetch(url, fetchInit)
    .then(function (res) {
      if (!res.ok) return null;
      return res.text();
    })
    .then(function (body) {
      if (!body || !isJson(body)) return null;
      return body.slice(0, maxSize);
    })
    .catch(function () {
      return null;
    });
}

function replayInPageHtml(
  url: string,
  method: string,
  headers: Record<string, string>,
  requestBody: string | null,
  maxSize: number,
): Promise<string | null> {
  var fetchInit: RequestInit = {
    method: method,
    headers: headers,
    credentials: "include",
  };
  if (requestBody && method !== "GET" && method !== "HEAD") {
    fetchInit.body = requestBody;
  }
  return fetch(url, fetchInit)
    .then(function (res) {
      if (!res.ok) return null;
      return res.text();
    })
    .then(function (body) {
      if (!body || body.length < 100) return null;
      return body.slice(0, maxSize);
    })
    .catch(function () {
      return null;
    });
}

export function setupWebRequestCapture(): void {
  chrome.webRequest.onBeforeRequest.addListener(
    onBeforeRequest,
    { urls: ["<all_urls>"] },
    ["requestBody", "extraHeaders"]
  );

  chrome.webRequest.onBeforeSendHeaders.addListener(
    onBeforeSendHeaders,
    { urls: ["<all_urls>"] },
    ["requestHeaders", "extraHeaders"]
  );

  chrome.webRequest.onCompleted.addListener(
    onCompleted,
    { urls: ["<all_urls>"] },
    ["responseHeaders", "extraHeaders"]
  );

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const url = changeInfo.url || (changeInfo.status === "loading" ? tab.url : undefined);
    if (!url || url.startsWith("chrome://") || url.startsWith("chrome-extension://")) return;
    tabUrls.set(tabId, url);
    const newDomain = getBaseDomain(url);
    const oldDomain = tabDomains.get(tabId);
    tabDomains.set(tabId, newDomain);
    if (oldDomain && oldDomain !== newDomain) {
      chrome.runtime.sendMessage({
        type: MessageType.TAB_DOMAIN_CHANGED,
        payload: { tabId, domain: newDomain },
      }).catch(() => {});
    }
  });

  if (chrome.webNavigation?.onHistoryStateUpdated) {
    chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
      if (details.frameId !== 0) return;
      tabUrls.set(details.tabId, details.url);
      tabDomains.set(details.tabId, getBaseDomain(details.url));
    });
  }

  let lastActiveDomain: string | null = null;

  chrome.tabs.onActivated.addListener((activeInfo) => {
    getTabDomain(activeInfo.tabId).then((domain) => {
      if (!domain || domain === lastActiveDomain) return;
      lastActiveDomain = domain;
      chrome.runtime.sendMessage({
        type: MessageType.TAB_DOMAIN_CHANGED,
        payload: { tabId: activeInfo.tabId, domain },
      }).catch(() => {});
    });
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    replayedUrls.delete(tabId);
    tabDomains.delete(tabId);
    tabUrls.delete(tabId);
    for (const [reqId, req] of pendingRequests) {
      if (req.tabId === tabId) pendingRequests.delete(reqId);
    }
    for (const [reqId, req] of pendingBodies) {
      if (req.tabId === tabId) pendingBodies.delete(reqId);
    }
  });
}

export function clearReplayedUrls(tabId: number): void {
  replayedUrls.delete(tabId);
}

export async function captureDocumentHtml(tabId: number): Promise<CapturedRequest | null> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) {
    return null;
  }

  // Check if the webRequest pipeline already captured this document
  const domain = await getTabDomain(tabId);
  if (domain) {
    const { getCapturedRequests } = await import("./storage");
    const existing = await getCapturedRequests(domain);
    const docCapture = existing.find((c) => c.sourceType === "html" && c.url === tab.url);
    if (docCapture) return docCapture;
  }

  // Fallback: extract from the live DOM (authenticated, JS-rendered)
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => document.documentElement.outerHTML,
    });

    const html = results?.[0]?.result;
    if (typeof html !== "string" || html.length < 100) return null;

    const origin = new URL(tab.url).origin;
    return {
      id: stableId("doc", `GET:${tab.url}`),
      url: tab.url,
      method: "GET",
      status: 200,
      requestHeaders: {},
      responseHeaders: { "content-type": "text/html" },
      responseBody: html.slice(0, MAX_HTML_SIZE),
      contentType: "text/html",
      timestamp: Date.now(),
      tabId,
      origin,
      sourceType: "html",
      pageUrl: tab.url,
    };
  } catch {
    return null;
  }
}

/**
 * Extract indexed fields from the live page DOM via chrome.scripting.
 * Runs in the page's MAIN world so DOM traversal works (service worker has no DOM).
 */
export async function indexHtmlInTab(tabId: number): Promise<IndexedField[]> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: extractFieldsInPage,
      args: [MAX_HTML_INDEX_FIELDS],
    });
    const fields = results?.[0]?.result;
    return Array.isArray(fields) ? fields : [];
  } catch {
    return [];
  }
}

function extractFieldsInPage(maxFields: number): Array<{
  path: string;
  type: "string" | "number" | "boolean" | "null" | "array" | "object";
  sampleValue: string;
  depth: number;
}> {
  var SKIP: Record<string, boolean> = {
    SCRIPT: true, STYLE: true, NOSCRIPT: true, SVG: true, PATH: true,
    META: true, LINK: true, BR: true, HR: true, IMG: true, INPUT: true,
    TEXTAREA: true, SELECT: true, IFRAME: true, CANVAS: true, VIDEO: true,
    AUDIO: true, SOURCE: true, PICTURE: true, OBJECT: true, EMBED: true,
  };
  var DATA_HINTS = /balance|amount|score|level|status|name|email|member|tier|points|rank|price|total|count|followers|following|rating|reputation|age|date|number|id|username|account/i;
  var NUMBER_PAT = /[$€¥£]?\s*[\d,]+\.?\d*\s*%?/;

  function inferType(text: string): "string" | "number" | "boolean" | "null" {
    var t = text.trim().replace(/[$€¥£,% ]/g, "");
    if (/^-?\d+(\.\d+)?$/.test(t)) return "number";
    if (t === "true" || t === "false") return "boolean";
    return "string";
  }

  function mask(v: string): string {
    return v
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "***@***.***")
      .replace(/\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}/g, "[CARD]");
  }

  function escapeCss(s: string): string {
    return s.replace(/([^\w-])/g, "\\$1");
  }

  function tagIdx(el: Element, tag: string): string {
    var p = el.parentElement;
    if (!p) return tag;
    var siblings = p.children, same = 0, idx = 0;
    for (var i = 0; i < siblings.length; i++) {
      if (siblings[i].tagName === el.tagName) { same++; if (siblings[i] === el) idx = same; }
    }
    return same > 1 ? tag + "[" + idx + "]" : tag;
  }

  function posAmong(el: Element, sel: string): string {
    var p = el.parentElement;
    if (!p) return "";
    var m = p.querySelectorAll(":scope > " + sel);
    for (var i = 0; i < m.length; i++) { if (m[i] === el) return "[" + (i + 1) + "]"; }
    return "";
  }

  function bStep(el: Element): string {
    var tag = el.tagName.toLowerCase();
    if (el.id) return tag + "[@id='" + el.id + "']";

    var cls = el.getAttribute("class");
    if (cls) {
      var classes = cls.trim().split(/\s+/);
      var good = classes.filter(function(c) {
        return c.length > 1 && !/^[a-z]{1,2}\d|^_|^js-|^ng-|^v-|^css-|^svelte-/.test(c) && c.length < 50;
      });
      if (good.length > 0) {
        var best = good[0];
        var parent = el.parentElement;
        if (parent) {
          var matches = parent.querySelectorAll(":scope > " + tag + "." + escapeCss(best));
          if (matches.length === 1) return tag + "[@class='" + best + "']";
          if (matches.length > 1) return tag + "[contains(@class,'" + best + "')]" + posAmong(el, tag + "." + escapeCss(best));
        } else {
          return tag + "[@class='" + best + "']";
        }
      }
    }

    var attrs = el.attributes;
    for (var i = 0; i < attrs.length; i++) {
      if (attrs[i].name.startsWith("data-") && attrs[i].value && attrs[i].value.length < 60)
        return tag + "[@" + attrs[i].name + "='" + attrs[i].value.replace(/'/g, "\\'") + "']";
    }

    var role = el.getAttribute("role");
    if (role) return tag + "[@role='" + role + "']";
    var name = el.getAttribute("name");
    if (name) return tag + "[@name='" + name + "']";
    return tagIdx(el, tag);
  }

  function getXPath(el: Element, body: Element): string {
    if (el.id) return "//" + el.tagName.toLowerCase() + "[@id='" + el.id + "']";
    var steps: string[] = [];
    var cur: Element | null = el;
    while (cur && cur !== body && cur !== body.parentElement) {
      steps.unshift(bStep(cur));
      if (cur.id) return "//" + cur.tagName.toLowerCase() + "[@id='" + cur.id + "']/" + steps.slice(1).join("/");
      cur = cur.parentElement;
    }
    return "/html/body/" + steps.join("/");
  }

  function getDepth(el: Element): number {
    var d = 0; var p: Element | null = el;
    while (p) { d++; p = p.parentElement; }
    return d;
  }

  function scoreField(text: string, el: Element): number {
    var s = 0;
    var t = text.trim().replace(/[$€¥£,% ]/g, "");
    if (/^-?\d+(\.\d+)?$/.test(t)) s += 10;
    if (NUMBER_PAT.test(text)) s += 5;
    if (text.length <= 50) s += 3;
    if (text.length <= 20) s += 2;
    var tag = el.tagName;
    if (tag === "TD" || tag === "TH" || tag === "DD" || tag === "DT") s += 4;
    if (tag === "SPAN" || tag === "STRONG" || tag === "B" || tag === "EM") s += 2;
    if (tag === "H1" || tag === "H2" || tag === "H3") s += 1;
    var ci = (el.className || "") + " " + (el.id || "");
    if (DATA_HINTS.test(ci)) s += 6;
    var aria = el.getAttribute("aria-label") || "";
    if (DATA_HINTS.test(aria)) s += 4;
    return s;
  }

  function directText(el: Element): string {
    var t = "";
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 3) t += el.childNodes[i].textContent || "";
    }
    return t.trim();
  }

  var body = document.body;
  if (!body) return [];

  var raw: Array<{ xpath: string; text: string; tag: string; depth: number; score: number }> = [];

  function walk(el: Element) {
    if (SKIP[el.tagName]) return;
    var dt = directText(el);
    if (dt.length > 0 && dt.length <= 500) {
      var sc = scoreField(dt, el);
      if (sc > 0 || dt.length <= 100) {
        raw.push({ xpath: getXPath(el, body), text: dt, tag: el.tagName.toLowerCase(), depth: getDepth(el), score: sc });
      }
    }
    for (var i = 0; i < el.children.length; i++) walk(el.children[i]);
  }

  walk(body);

  raw.sort(function(a, b) { return b.score - a.score; });
  var top = raw.slice(0, maxFields);
  return top.map(function(f) {
    var sv = f.text.length > 100 ? f.text.slice(0, 100) + "..." : f.text;
    return { path: f.xpath, type: inferType(f.text), sampleValue: mask(sv), depth: f.depth };
  });
}
