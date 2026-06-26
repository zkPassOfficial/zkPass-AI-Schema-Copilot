import type { Subagent, SubagentInput, SubagentOutput } from "./types";
import type { ZkPassSchema } from "@/shared/types";
import { ZKPASS_PROJECT_ID, ZKPASS_SCHEMA_SUBMIT_URL } from "@/shared/constants";
import { verifySchema as runVerification } from "@/background/verify";

async function submitSchema(
  schema: ZkPassSchema,
  name: string,
): Promise<{ success: boolean; schemaId?: string; error?: string }> {
  try {
    const response = await fetch(ZKPASS_SCHEMA_SUBMIT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dev_interface_category: "Agent Generate",
        dev_interface_doc: JSON.stringify(schema),
        dev_interface_name: `${name}-${Date.now()}-agent`,
        dev_project_id: ZKPASS_PROJECT_ID,
      }),
    });

    if (!response.ok) {
      return { success: false, error: `Submit failed: ${response.status} ${response.statusText}` };
    }

    const result = await response.json();
    if (result.errno !== "0" || !result.info?.dev_interface_id) {
      return { success: false, error: result.msg || "No schema ID returned from server." };
    }

    return { success: true, schemaId: result.info.dev_interface_id };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Submit failed." };
  }
}

export const verifyAgent: Subagent = {
  name: "verify",

  async execute({ scratchpad, sendProgress }: SubagentInput): Promise<SubagentOutput> {
    const { schema, tabId } = scratchpad;
    if (!schema) {
      return { success: false, error: "No schema to verify.", scratchpadUpdates: {} };
    }

    const host = schema.APIs[0]?.host || "unknown";
    const name = host.replace(/^(www\.|api\.)/, "").split(".")[0];

    sendProgress("Submitting schema to zkPass...");
    const submitResult = await submitSchema(schema, name);
    if (!submitResult.success || !submitResult.schemaId) {
      return { success: false, error: submitResult.error || "Submit failed.", scratchpadUpdates: {} };
    }

    sendProgress(`Schema submitted. ID: ${submitResult.schemaId}. Running verification...`);
    const result = await runVerification(tabId, ZKPASS_PROJECT_ID, submitResult.schemaId, schema.httpVersion);

    if (!result.success && result.code === "TLS_PROXY_FAILED" && !schema.httpVersion) {
      sendProgress("HTTP/1.1 failed. Retrying with HTTP/2.0...");
      const h2Schema: ZkPassSchema = { ...schema, httpVersion: "2.0" };

      const resubmit = await submitSchema(h2Schema, name);
      if (!resubmit.success || !resubmit.schemaId) {
        return { success: false, error: resubmit.error || "Re-submit failed.", scratchpadUpdates: {} };
      }

      const retryResult = await runVerification(tabId, ZKPASS_PROJECT_ID, resubmit.schemaId, "2.0");
      return {
        success: retryResult.success,
        error: retryResult.success ? undefined : (retryResult.error || "Verification failed with HTTP/2.0"),
        scratchpadUpdates: { verifyResult: retryResult },
      };
    }

    return {
      success: result.success,
      error: result.success ? undefined : (result.error || "Verification failed."),
      scratchpadUpdates: { verifyResult: result },
    };
  },
};
