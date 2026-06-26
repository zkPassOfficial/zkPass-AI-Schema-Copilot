import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "zkPass AI Schema Copilot",
  version: "2.0.0",
  description: "AI copilot that generates zkPass schemas from natural language by observing authenticated web APIs.",
  permissions: ["storage", "activeTab", "scripting", "tabs", "sidePanel", "webRequest", "webNavigation", "contextMenus"],
  host_permissions: ["<all_urls>"],
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  side_panel: {
    default_path: "src/sidepanel/index.html",
  },
  options_ui: {
    page: "src/options/index.html",
    open_in_tab: true,
  },
  action: {
    default_title: "zkPass AI Schema Copilot",
    default_icon: {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png",
    },
  },
  icons: {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png",
  },
});
