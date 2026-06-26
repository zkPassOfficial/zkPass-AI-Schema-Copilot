import type { CapturedRequest } from "@/shared/types";

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}

function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case "GET": return "#49cc90";
    case "POST": return "#61affe";
    case "PUT": return "#fca130";
    case "DELETE": return "#f93e3e";
    case "PATCH": return "#50e3c2";
    default: return "#999";
  }
}

function renderHeaders(headers: Record<string, string>): string {
  const entries = Object.entries(headers);
  if (entries.length === 0) return "<p class='empty'>No headers</p>";
  const rows = entries.map(([k, v]) =>
    `<tr><td class="hdr-key">${escapeHtml(k)}</td><td class="hdr-val">${escapeHtml(v)}</td></tr>`
  ).join("");
  return `<table class="hdr-table"><thead><tr><th>Header</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderBody(body: string | null | undefined, label: string): string {
  if (!body) return `<p class='empty'>No ${label}</p>`;
  const formatted = formatJson(body);
  return `<pre class="body-block">${escapeHtml(formatted)}</pre>`;
}

interface GroupedApis {
  host: string;
  requests: CapturedRequest[];
}

interface PageGroup {
  pageUrl: string;
  hostGroups: GroupedApis[];
  totalRequests: number;
}

function groupByHost(captures: CapturedRequest[]): GroupedApis[] {
  const map = new Map<string, CapturedRequest[]>();
  for (const c of captures) {
    let host: string;
    try { host = new URL(c.url).host; } catch { host = "unknown"; }
    const list = map.get(host) || [];
    list.push(c);
    map.set(host, list);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([host, requests]) => ({
      host,
      requests: requests.sort((a, b) => {
        try {
          return new URL(a.url).pathname.localeCompare(new URL(b.url).pathname);
        } catch { return 0; }
      }),
    }));
}

function groupByPageUrl(captures: CapturedRequest[]): PageGroup[] {
  const map = new Map<string, CapturedRequest[]>();
  for (const c of captures) {
    const key = c.pageUrl || "Unknown Page";
    const list = map.get(key) || [];
    list.push(c);
    map.set(key, list);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pageUrl, requests]) => ({
      pageUrl,
      hostGroups: groupByHost(requests),
      totalRequests: requests.length,
    }));
}

function buildHtml(captures: CapturedRequest[], domain: string): string {
  const pageGroups = groupByPageUrl(captures);
  const timestamp = new Date().toISOString();

  const pageSections = pageGroups.map((pg, pgIdx) => {
    const hostSections = pg.hostGroups.map((group) => {
      const endpoints = group.requests.map((req, i) => {
        let pathname: string;
        let query = "";
        try {
          const u = new URL(req.url);
          pathname = u.pathname;
          query = u.search;
        } catch {
          pathname = req.url;
        }
        const color = methodColor(req.method);
        const id = `api-p${pgIdx}-${escapeHtml(group.host)}-${i}`;
        const hasReqBody = req.sourceType !== "html" && req.method !== "GET";

        return `
        <div class="endpoint">
          <div class="endpoint-header" onclick="toggle('${id}')">
            <span class="method-badge" style="background:${color}">${escapeHtml(req.method)}</span>
            <span class="path">${escapeHtml(pathname)}${escapeHtml(query)}</span>
            <span class="status-badge">${req.status}</span>
            <span class="toggle-icon" id="icon-${id}">+</span>
          </div>
          <div class="endpoint-body" id="${id}" style="display:none">
            <div class="section">
              <h4>Request Headers</h4>
              ${renderHeaders(req.requestHeaders)}
            </div>
            ${hasReqBody ? `<div class="section"><h4>Request Body</h4>${renderBody((req as CapturedRequest & { requestBody?: string }).requestBody || null, "body")}</div>` : ""}
            <div class="section">
              <h4>Response Headers</h4>
              ${renderHeaders(req.responseHeaders)}
            </div>
            <div class="section">
              <h4>Response Body</h4>
              ${renderBody(req.responseBody, "body")}
            </div>
          </div>
        </div>`;
      }).join("");

      return `
      <div class="host-group">
        <h3 class="host-title">${escapeHtml(group.host)}<span class="count">${group.requests.length} endpoint${group.requests.length !== 1 ? "s" : ""}</span></h3>
        ${endpoints}
      </div>`;
    }).join("");

    const pageId = `page-${pgIdx}`;
    let displayUrl = pg.pageUrl;
    try {
      const u = new URL(pg.pageUrl);
      displayUrl = u.pathname + u.search;
    } catch { /* keep full string */ }

    return `
    <div class="page-group">
      <div class="page-header" onclick="togglePage('${pageId}')">
        <span class="page-url">${escapeHtml(displayUrl)}</span>
        <span class="page-full-url">${escapeHtml(pg.pageUrl)}</span>
        <span class="count">${pg.totalRequests} request${pg.totalRequests !== 1 ? "s" : ""}</span>
        <span class="toggle-icon" id="icon-${pageId}">−</span>
      </div>
      <div class="page-body" id="${pageId}">
        ${hostSections}
      </div>
    </div>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>API Export — ${escapeHtml(domain)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background:#fafafa; color:#3b4151; line-height:1.6; }
  .topbar { background:#3d3d3d; padding:12px 24px; color:#fff; display:flex; align-items:center; gap:12px; }
  .topbar h1 { font-size:18px; font-weight:600; }
  .topbar .domain { color:#c5ff4a; font-size:14px; }
  .topbar .meta { margin-left:auto; font-size:11px; color:#aaa; }
  .container { max-width:1200px; margin:0 auto; padding:24px; }
  .page-group { margin-bottom:28px; border:1px solid #d0d5dd; border-radius:8px; overflow:hidden; }
  .page-header { display:flex; align-items:center; gap:10px; padding:12px 20px; cursor:pointer; background:#eef1e6; border-bottom:1px solid #d0d5dd; transition:background .15s; }
  .page-header:hover { background:#e4e8da; }
  .page-url { font-family:"SF Mono",Monaco,Consolas,monospace; font-size:14px; font-weight:600; color:#3b4151; }
  .page-full-url { font-family:"SF Mono",Monaco,Consolas,monospace; font-size:11px; color:#888; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .page-body { padding:12px 16px; }
  .host-group { margin-bottom:20px; }
  .host-title { font-size:16px; font-weight:600; color:#3b4151; border-bottom:2px solid #c5ff4a; padding-bottom:6px; margin-bottom:12px; display:flex; align-items:center; gap:12px; }
  .host-title .count { font-size:12px; font-weight:400; color:#888; }
  .count { font-size:12px; font-weight:400; color:#888; }
  .endpoint { border:1px solid #e0e0e0; border-radius:6px; margin-bottom:8px; overflow:hidden; }
  .endpoint-header { display:flex; align-items:center; gap:10px; padding:10px 16px; cursor:pointer; background:#fff; transition:background .15s; }
  .endpoint-header:hover { background:#f8f9fa; }
  .method-badge { color:#fff; font-size:11px; font-weight:700; padding:3px 10px; border-radius:3px; min-width:60px; text-align:center; text-transform:uppercase; }
  .path { font-family:"SF Mono",Monaco,Consolas,monospace; font-size:13px; color:#3b4151; flex:1; word-break:break-all; }
  .status-badge { font-size:11px; font-weight:600; color:#49cc90; background:#e8f5e9; padding:2px 8px; border-radius:3px; }
  .toggle-icon { font-size:16px; font-weight:700; color:#888; width:20px; text-align:center; }
  .endpoint-body { padding:16px; background:#fafcff; border-top:1px solid #e8e8e8; }
  .section { margin-bottom:16px; }
  .section:last-child { margin-bottom:0; }
  .section h4 { font-size:12px; font-weight:600; text-transform:uppercase; color:#888; letter-spacing:0.05em; margin-bottom:8px; }
  .hdr-table { width:100%; border-collapse:collapse; font-size:12px; }
  .hdr-table th { text-align:left; padding:4px 8px; background:#f0f0f0; border:1px solid #e0e0e0; font-weight:600; color:#555; }
  .hdr-table td { padding:4px 8px; border:1px solid #e0e0e0; }
  .hdr-key { font-family:monospace; color:#d63384; white-space:nowrap; }
  .hdr-val { font-family:monospace; word-break:break-all; color:#3b4151; }
  .body-block { background:#1e1e1e; color:#d4d4d4; padding:12px 16px; border-radius:4px; font-size:12px; font-family:"SF Mono",Monaco,Consolas,monospace; overflow-x:auto; white-space:pre-wrap; word-break:break-word; max-height:500px; overflow-y:auto; }
  .empty { font-size:12px; color:#aaa; font-style:italic; }
  .expand-all { background:#3d3d3d; color:#c5ff4a; border:none; padding:6px 14px; border-radius:4px; font-size:12px; font-weight:600; cursor:pointer; margin-bottom:20px; }
  .expand-all:hover { background:#272727; }
</style>
</head>
<body>
<div class="topbar">
  <h1>API Export</h1>
  <span class="domain">${escapeHtml(domain)}</span>
  <span class="meta">Exported ${escapeHtml(timestamp)} &bull; ${captures.length} request${captures.length !== 1 ? "s" : ""} &bull; ${pageGroups.length} page${pageGroups.length !== 1 ? "s" : ""}</span>
</div>
<div class="container">
  <button class="expand-all" onclick="toggleAll()">Expand / Collapse All</button>
  ${pageSections}
</div>
<script>
function toggle(id){
  var el=document.getElementById(id);
  var icon=document.getElementById("icon-"+id);
  if(el.style.display==="none"){el.style.display="block";icon.textContent="\\u2212";}
  else{el.style.display="none";icon.textContent="+";}
}
function togglePage(id){
  var el=document.getElementById(id);
  var icon=document.getElementById("icon-"+id);
  if(el.style.display==="none"){el.style.display="block";icon.textContent="\\u2212";}
  else{el.style.display="none";icon.textContent="+";}
}
var _allOpen=true;
function toggleAll(){
  _allOpen=!_allOpen;
  document.querySelectorAll(".endpoint-body").forEach(function(el){el.style.display=_allOpen?"block":"none";});
  document.querySelectorAll(".page-body").forEach(function(el){el.style.display=_allOpen?"block":"none";});
  document.querySelectorAll(".toggle-icon").forEach(function(el){el.textContent=_allOpen?"\\u2212":"+";});
}
</script>
</body>
</html>`;
}

export function exportCapturesAsHtml(captures: CapturedRequest[], domain: string): void {
  const html = buildHtml(captures, domain);
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `api-export-${domain}-${Date.now()}.html`;
  a.click();
  URL.revokeObjectURL(url);
}
