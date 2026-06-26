import type { AiConfig } from "@/shared/constants";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface LlmCallParams {
  config: AiConfig;
  systemPrompt: string;
  userPrompt: string;
  history?: ChatTurn[];
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function parseErrorBody(response: Response): Promise<string> {
  try {
    const body = await response.text();
    try {
      const json = JSON.parse(body);
      return json.error?.message || json.error?.type || body.slice(0, 300);
    } catch {
      return body.slice(0, 300);
    }
  } catch {
    return response.statusText;
  }
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const response = await fetch(url, init);

    if (response.ok) return response;

    if (response.status === 429 || response.status === 529 || response.status >= 500) {
      const retryAfter = response.headers.get("retry-after");
      const waitMs = retryAfter
        ? Math.min(parseInt(retryAfter, 10) * 1000, 30000)
        : BASE_DELAY_MS * Math.pow(2, attempt);

      const detail = await parseErrorBody(response);
      lastError = new Error(`[${response.status}] ${detail}`);

      if (attempt < MAX_RETRIES - 1) {
        await sleep(waitMs);
        continue;
      }
      break;
    }

    const detail = await parseErrorBody(response);

    if (response.status === 401) {
      throw new Error("Invalid API key. Please check your settings.");
    }
    if (response.status === 403) {
      throw new Error(`Access denied: ${detail}`);
    }
    if (response.status === 400) {
      throw new Error(`Bad request: ${detail}`);
    }

    throw new Error(`API error ${response.status}: ${detail}`);
  }

  throw lastError || new Error("Request failed after retries.");
}

async function callClaude(config: AiConfig, systemPrompt: string, userPrompt: string, history?: ChatTurn[]): Promise<string> {
  const messages: Array<{ role: string; content: string }> = [];
  if (history) {
    for (const turn of history) {
      messages.push({ role: turn.role, content: turn.content });
    }
  }
  messages.push({ role: "user", content: userPrompt });

  const baseUrl = config.endpoint.replace(/\/+$/, "");
  const response = await fetchWithRetry(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
    }),
  });

  const data = await response.json();
  const text = data.content?.find((b: { type: string }) => b.type === "text")?.text;
  if (!text) throw new Error("Empty response from Claude.");
  return text;
}

async function callOpenAI(config: AiConfig, systemPrompt: string, userPrompt: string, history?: ChatTurn[]): Promise<string> {
  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: systemPrompt },
  ];
  if (history) {
    for (const turn of history) {
      messages.push({ role: turn.role, content: turn.content });
    }
  }
  messages.push({ role: "user", content: userPrompt });

  const baseUrl = config.endpoint.replace(/\/+$/, "");
  const response = await fetchWithRetry(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.2,
      max_completion_tokens: 4096,
    }),
  });

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from OpenAI.");
  return content;
}

export async function callLlm(params: LlmCallParams): Promise<string> {
  const { config, systemPrompt, userPrompt, history } = params;
  if (config.provider === "claude") {
    return callClaude(config, systemPrompt, userPrompt, history);
  }
  return callOpenAI(config, systemPrompt, userPrompt, history);
}

export async function testConnection(config: AiConfig): Promise<boolean> {
  try {
    const baseUrl = config.endpoint.replace(/\/+$/, "");
    if (config.provider === "claude") {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: 10,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      return res.ok;
    } else {
      const res = await fetch(`${baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });
      return res.ok;
    }
  } catch {
    return false;
  }
}
