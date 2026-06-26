import { setupMessageHandler } from "./message-handler";
import { setupWebRequestCapture } from "./capture";

chrome.storage.session.setAccessLevel({
  accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS",
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "generate-schema",
    title: "Generate Schema",
    contexts: ["page", "selection"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "generate-schema" || !tab?.id) return;
  await chrome.sidePanel.open({ tabId: tab.id });
});

setupWebRequestCapture();
setupMessageHandler();
