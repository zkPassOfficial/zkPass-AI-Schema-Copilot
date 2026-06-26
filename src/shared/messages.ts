import type { ExtensionMessage } from "./types";

export function sendToBackground<T>(type: string, payload?: unknown): Promise<T> {
  return chrome.runtime.sendMessage<ExtensionMessage, T>({ type, payload });
}
