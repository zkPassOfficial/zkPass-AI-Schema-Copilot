import type { Subagent, SubagentInput, SubagentOutput } from "./types";
import type { CapturedRequest } from "@/shared/types";
import {
  PAGE_SETTLE_DELAY_MS,
  PAGE_SETTLE_POLL_MS,
  PAGE_SETTLE_TIMEOUT_MS,
} from "@/shared/constants";
import { getCapturedRequests, getCaptureCount, storeCapturedRequest } from "@/background/storage";
import { clearReplayedUrls, captureDocumentHtml, indexHtmlInTab, getTabDomain } from "@/background/capture";
import { buildApiCandidates, buildHtmlCandidate } from "@/network/candidates";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForPageSettle(domain: string): Promise<void> {
  await sleep(PAGE_SETTLE_DELAY_MS);
  const startTime = Date.now();
  let lastCount = -1;
  let stableRounds = 0;
  while (Date.now() - startTime < PAGE_SETTLE_TIMEOUT_MS) {
    const count = await getCaptureCount(domain);
    if (count === lastCount) {
      stableRounds++;
      if (stableRounds >= 3) return;
    } else {
      stableRounds = 0;
    }
    lastCount = count;
    await sleep(PAGE_SETTLE_POLL_MS);
  }
}

async function reloadAndCapture(tabId: number, domain: string): Promise<CapturedRequest[]> {
  clearReplayedUrls(tabId);
  await chrome.tabs.reload(tabId);
  await waitForPageSettle(domain);
  return getCapturedRequests(domain);
}

async function attachHtmlAndBuildCandidates(
  tabId: number,
  domain: string,
  captures: CapturedRequest[],
) {
  let htmlCapture: CapturedRequest | null = null;
  try { htmlCapture = await captureDocumentHtml(tabId); } catch { /* optional */ }

  const candidates = buildApiCandidates(captures);

  // Collect all HTML captures: the main document + any fetch-type HTML responses from storage
  const htmlCaptures: CapturedRequest[] = captures.filter((c) => c.sourceType === "html");
  if (htmlCapture && !htmlCaptures.some((c) => c.id === htmlCapture!.id)) {
    htmlCaptures.push(htmlCapture);
  }

  if (htmlCaptures.length > 0) {
    try {
      // indexHtmlInTab extracts fields from the live DOM — use for the main document
      const liveFields = await indexHtmlInTab(tabId);

      for (const hc of htmlCaptures) {
        // For the main document (matching tab URL), use live DOM fields
        // For fetch-type HTML responses, parse in-page via scripting
        let fields = liveFields;
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (tab && hc.url !== tab.url) {
          fields = await indexHtmlViaScript(tabId, hc.responseBody);
        }

        const htmlCandidate = buildHtmlCandidate(hc, fields);
        if (htmlCandidate) {
          candidates.push(htmlCandidate);
          if (!captures.some((c) => c.id === hc.id)) {
            captures.push(hc);
            await storeCapturedRequest(domain, hc);
          }
        }
      }
    } catch { /* optional */ }
  }

  return { captures, candidates };
}

async function indexHtmlViaScript(tabId: number, html: string): Promise<import("@/shared/types").IndexedField[]> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: parseHtmlFields,
      args: [html, 200],
    });
    const fields = results?.[0]?.result;
    return Array.isArray(fields) ? fields : [];
  } catch {
    return [];
  }
}

function parseHtmlFields(html: string, maxFields: number): Array<{
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

  function escapeCss(s: string): string { return s.replace(/([^\w-])/g, "\\$1"); }

  function tagIdx(el: Element, tag: string): string {
    var p = el.parentElement; if (!p) return tag;
    var siblings = p.children, same = 0, idx = 0;
    for (var i = 0; i < siblings.length; i++) { if (siblings[i].tagName === el.tagName) { same++; if (siblings[i] === el) idx = same; } }
    return same > 1 ? tag + "[" + idx + "]" : tag;
  }

  function posAmong(el: Element, sel: string): string {
    var p = el.parentElement; if (!p) return "";
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
      var good = classes.filter(function(c) { return c.length > 1 && !/^[a-z]{1,2}\d|^_|^js-|^ng-|^v-|^css-|^svelte-/.test(c) && c.length < 50; });
      if (good.length > 0) {
        var best = good[0], parent = el.parentElement;
        if (parent) {
          var matches = parent.querySelectorAll(":scope > " + tag + "." + escapeCss(best));
          if (matches.length === 1) return tag + "[@class='" + best + "']";
          if (matches.length > 1) return tag + "[contains(@class,'" + best + "')]" + posAmong(el, tag + "." + escapeCss(best));
        } else { return tag + "[@class='" + best + "']"; }
      }
    }
    var attrs = el.attributes;
    for (var i = 0; i < attrs.length; i++) { if (attrs[i].name.startsWith("data-") && attrs[i].value && attrs[i].value.length < 60) return tag + "[@" + attrs[i].name + "='" + attrs[i].value.replace(/'/g, "\\'") + "']"; }
    var role = el.getAttribute("role"); if (role) return tag + "[@role='" + role + "']";
    var name = el.getAttribute("name"); if (name) return tag + "[@name='" + name + "']";
    return tagIdx(el, tag);
  }

  function getXPath(el: Element, body: Element): string {
    if (el.id) return "//" + el.tagName.toLowerCase() + "[@id='" + el.id + "']";
    var steps: string[] = [], cur: Element | null = el;
    while (cur && cur !== body && cur !== body.parentElement) { steps.unshift(bStep(cur)); if (cur.id) return "//" + cur.tagName.toLowerCase() + "[@id='" + cur.id + "']/" + steps.slice(1).join("/"); cur = cur.parentElement; }
    return "/html/body/" + steps.join("/");
  }

  function getDepth(el: Element): number { var d = 0; var p: Element | null = el; while (p) { d++; p = p.parentElement; } return d; }

  function scoreField(text: string, el: Element): number {
    var s = 0, t = text.trim().replace(/[$€¥£,% ]/g, "");
    if (/^-?\d+(\.\d+)?$/.test(t)) s += 10; if (NUMBER_PAT.test(text)) s += 5;
    if (text.length <= 50) s += 3; if (text.length <= 20) s += 2;
    var tag = el.tagName;
    if (tag === "TD" || tag === "TH" || tag === "DD" || tag === "DT") s += 4;
    if (tag === "SPAN" || tag === "STRONG" || tag === "B" || tag === "EM") s += 2;
    var ci = (el.className || "") + " " + (el.id || ""); if (DATA_HINTS.test(ci)) s += 6;
    var aria = el.getAttribute("aria-label") || ""; if (DATA_HINTS.test(aria)) s += 4;
    return s;
  }

  function directText(el: Element): string {
    var t = ""; for (var i = 0; i < el.childNodes.length; i++) { if (el.childNodes[i].nodeType === 3) t += el.childNodes[i].textContent || ""; }
    return t.trim();
  }

  var doc = new DOMParser().parseFromString(html, "text/html");
  var body = doc.body; if (!body) return [];
  var raw: Array<{ xpath: string; text: string; tag: string; depth: number; score: number }> = [];

  function walk(el: Element) {
    if (SKIP[el.tagName]) return;
    var dt = directText(el);
    if (dt.length > 0 && dt.length <= 500) { var sc = scoreField(dt, el); if (sc > 0 || dt.length <= 100) { raw.push({ xpath: getXPath(el, body), text: dt, tag: el.tagName.toLowerCase(), depth: getDepth(el), score: sc }); } }
    for (var i = 0; i < el.children.length; i++) walk(el.children[i]);
  }
  walk(body);

  raw.sort(function(a, b) { return b.score - a.score; });
  return raw.slice(0, maxFields).map(function(f) {
    var sv = f.text.length > 100 ? f.text.slice(0, 100) + "..." : f.text;
    return { path: f.xpath, type: inferType(f.text), sampleValue: mask(sv), depth: f.depth };
  });
}

export const captureAgent: Subagent = {
  name: "capture",

  async execute({ scratchpad, sendProgress }: SubagentInput): Promise<SubagentOutput> {
    const { tabId, domain, reuseCaptures } = scratchpad;

    if (!domain) {
      return { success: false, error: "Cannot determine the current page's domain.", scratchpadUpdates: {} };
    }

    let captures: CapturedRequest[];

    if (reuseCaptures) {
      sendProgress("Using accumulated captures from your browsing...");
      captures = await getCapturedRequests(domain);
      if (captures.length === 0) {
        sendProgress("No existing captures found. Reloading page...");
        try {
          captures = await reloadAndCapture(tabId, domain);
        } catch (err) {
          return { success: false, error: `Failed to reload page: ${err instanceof Error ? err.message : "Unknown error"}`, scratchpadUpdates: {} };
        }
      }
    } else {
      sendProgress("Reloading page to capture API traffic...");
      try {
        captures = await reloadAndCapture(tabId, domain);
      } catch (err) {
        return { success: false, error: `Failed to reload page: ${err instanceof Error ? err.message : "Unknown error"}`, scratchpadUpdates: {} };
      }
    }

    const result = await attachHtmlAndBuildCandidates(tabId, domain, captures);

    if (result.candidates.length === 0) {
      return {
        success: true,
        scratchpadUpdates: {
          captures: result.captures,
          candidates: result.candidates,
        },
      };
    }

    sendProgress(`Captured ${result.candidates.length} source(s). Analyzing with AI...`);

    return {
      success: true,
      scratchpadUpdates: {
        captures: result.captures,
        candidates: result.candidates,
      },
    };
  },
};

export async function reloadOnly(tabId: number): Promise<{ success: boolean; captureCount: number; error?: string }> {
  const domain = await getTabDomain(tabId);
  if (!domain) {
    return { success: false, captureCount: 0, error: "Cannot determine the current page's domain." };
  }

  try {
    const captures = await reloadAndCapture(tabId, domain);
    const result = await attachHtmlAndBuildCandidates(tabId, domain, captures);
    return { success: true, captureCount: result.candidates.length || captures.length };
  } catch (err) {
    return { success: false, captureCount: 0, error: `Failed to reload page: ${err instanceof Error ? err.message : "Unknown error"}` };
  }
}
