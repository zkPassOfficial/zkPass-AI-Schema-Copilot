import { TransGateExtensionCore } from "@zkpass/transgate-extension-sdk";
import { MessageType } from "@/shared/constants";

// Run one verification. Returns the SDK result directly:
//   success → { success: true, taskId, validatorSignature, uHash, publicFields, ... }
//   failure → { success: false, code, error }
export async function verifySchema(
  tabId: number,
  appId: string,
  schemaId: string,
  httpVersion?: string,
) {
  const sdk = new TransGateExtensionCore();

  return sdk.runZKTLS({
    schemaId: schemaId.replace(/^0x/, ""), // the zkPass /schema endpoint rejects a 0x prefix

    appId,
    // Generated fresh per run and discarded; never persisted.
    aesKeys: {
      aesKey: crypto.getRandomValues(new Uint8Array(32)),
      aesNonce: crypto.getRandomValues(new Uint8Array(12)),
    },
    httpVersion: httpVersion ?? "1.1", // default to HTTP/1.1 when unset
    onStatus: (msg: string) => {
      // Broadcast to the side panel to drive the progress block (ignored when no receiver).
      chrome.runtime.sendMessage({ type: MessageType.VERIFY_PROGRESS, status: msg }).catch(() => {});
    },
    // The SDK calls onListening exactly once after its webRequest listener is ready.
    // That is the moment to trigger the target request: reload the tab so the page re-issues it.
    onListening: () => {
      void chrome.tabs.reload(tabId).catch(() => {
        /* the tab may already be closed; ignore */
      });
    },
  });
}
