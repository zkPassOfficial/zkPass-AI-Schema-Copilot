import { useState, useEffect } from "react";
import {
  type AiProvider,
  type AiConfig,
  PROVIDERS,
  DEFAULT_PROVIDER,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CLAUDE_ENDPOINT,
  MessageType,
  getDefaultEndpoint,
  getDefaultModel,
} from "@/shared/constants";
import { sendToBackground } from "@/shared/messages";

const fieldLabel = "mb-2 block text-sm font-medium text-[#3d3d3d]";
const fieldHelp = "mt-2 text-xs leading-5 text-[#65705d]";
const inputClass =
  "h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-[#bfc8b3] focus:border-[#3d3d3d] focus:ring-4 focus:ring-[#c5ff4a]/35";

export default function Options() {
  const [provider, setProvider] = useState<AiProvider>(DEFAULT_PROVIDER);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(DEFAULT_CLAUDE_MODEL);
  const [endpoint, setEndpoint] = useState(DEFAULT_CLAUDE_ENDPOINT);
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "fail" | null>(null);
  const [testError, setTestError] = useState("");

  useEffect(() => {
    sendToBackground<AiConfig>(MessageType.GET_AI_CONFIG)
      .then((config) => {
        if (config) {
          setProvider(config.provider);
          setApiKey(config.apiKey);
          setModel(config.model);
          setEndpoint(config.endpoint);
        }
      })
      .catch(() => {
        setTestResult("fail");
        setTestError("Unable to load saved settings from the extension background.");
      });
  }, []);

  function handleProviderChange(newProvider: AiProvider) {
    setProvider(newProvider);
    setModel(getDefaultModel(newProvider));
    setEndpoint(getDefaultEndpoint(newProvider));
    setApiKey("");
    setTestResult(null);
    setTestError("");
  }

  function buildConfig(): AiConfig {
    return {
      provider,
      apiKey,
      model: model.trim() || getDefaultModel(provider),
      endpoint: endpoint.trim() || getDefaultEndpoint(provider),
    };
  }

  async function handleSave() {
    const config = buildConfig();
    try {
      await sendToBackground(MessageType.SET_AI_CONFIG, config);
      setModel(config.model);
      setEndpoint(config.endpoint);
      setSaved(true);
      setTestError("");
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setTestResult("fail");
      setTestError(err instanceof Error ? err.message : "Failed to save settings.");
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    setTestError("");
    const config = buildConfig();
    setModel(config.model);
    setEndpoint(config.endpoint);
    try {
      const ok = await sendToBackground<boolean>(MessageType.TEST_CONNECTION, config);
      setTestResult(ok ? "success" : "fail");
      setTestError(ok ? "" : "Connection failed. Check the key, endpoint, and model name.");
    } catch (err) {
      setTestResult("fail");
      setTestError(err instanceof Error ? err.message : "Connection test failed.");
    } finally {
      setTesting(false);
    }
  }

  const keyPlaceholder = provider === "claude" ? "sk-ant-..." : "sk-...";
  const canSubmit = Boolean(apiKey.trim());
  const providerLabel = PROVIDERS.find((p) => p.id === provider)?.label ?? provider;

  return (
    <main className="min-h-screen bg-[#f3f5ec] text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-6 sm:px-8 lg:px-10">
        <header className="flex flex-col gap-4 border-b border-[#d8dec9] pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6f8f12]">Extension Settings</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-normal text-[#272727]">
              zkPass AI Schema Copilot
            </h1>
          </div>
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
            <span className={`h-2 w-2 rounded-full ${apiKey ? "bg-[#c5ff4a]" : "bg-slate-300"}`} />
            {apiKey ? "Provider configured" : "Provider not configured"}
          </div>
        </header>

        <section className="grid flex-1 gap-6 py-6 lg:grid-cols-[0.8fr_1.2fr]">
          <aside className="rounded-lg border border-[#d8dec9] bg-[#3d3d3d] p-6 text-[#f8fcef] shadow-sm">
            <div className="flex h-full flex-col justify-between gap-8">
              <div>
                <img
                  src="/icons/zkpass-logomark.svg"
                  alt="zkPass"
                  className="h-10 w-10 rounded-md border border-[#c5ff4a]/30"
                />
                <h2 className="mt-5 text-xl font-semibold tracking-normal">AI provider setup</h2>
                <p className="mt-3 max-w-sm text-sm leading-6 text-[#dfe6d4]">
                  Configure the model used to inspect captured authenticated API traffic and draft zkPass schemas from natural language.
                </p>
              </div>

              <div className="space-y-4 text-sm">
                <div className="border-t border-[#c5ff4a]/25 pt-4">
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#bfc8b3]">Current Provider</p>
                  <p className="mt-1 font-medium text-[#f8fcef]">{providerLabel}</p>
                </div>
                <div className="border-t border-[#c5ff4a]/25 pt-4">
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#bfc8b3]">Model</p>
                  <p className="mt-1 break-all font-medium text-[#f8fcef]">{model || "Not selected"}</p>
                </div>
                <div className="border-t border-[#c5ff4a]/25 pt-4">
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#bfc8b3]">Connection</p>
                  <p className="mt-1 font-medium text-[#f8fcef]">
                    {testResult === "success" ? "Test passed" : testResult === "fail" ? "Needs attention" : "Untested"}
                  </p>
                </div>
              </div>
            </div>
          </aside>

          <form
            className="rounded-lg border border-[#d8dec9] bg-white p-5 shadow-sm sm:p-6"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSubmit) void handleSave();
            }}
          >
            <div className="mb-6 flex flex-col gap-3 border-b border-[#d8dec9] pb-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-[#272727]">Connection Details</h2>
                  <p className="mt-1 text-sm text-[#65705d]">Use an Anthropic-compatible or OpenAI-compatible endpoint.</p>
              </div>
              {saved && (
                <span className="inline-flex w-fit items-center rounded-full bg-[#f4ffd8] px-3 py-1 text-xs font-medium text-[#456000] ring-1 ring-[#c5ff4a]/60">
                  Saved
                </span>
              )}
            </div>

            <div className="space-y-6">
              <div>
                <label className={fieldLabel}>AI Provider</label>
                <div className="grid gap-3 sm:grid-cols-2">
                  {PROVIDERS.map((p) => {
                    const selected = provider === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleProviderChange(p.id)}
                        className={`rounded-md border p-4 text-left transition ${
                          selected
                            ? "border-[#3d3d3d] bg-[#f4ffd8] shadow-sm ring-4 ring-[#c5ff4a]/35"
                            : "border-slate-300 bg-white hover:border-slate-400 hover:bg-slate-50"
                        }`}
                        aria-pressed={selected}
                      >
                        <span className="flex items-center justify-between gap-3">
                          <span className="text-sm font-semibold text-[#272727]">{p.label}</span>
                          <span
                            className={`h-4 w-4 rounded-full border ${
                              selected ? "border-[#3d3d3d] bg-[#c5ff4a] shadow-[inset_0_0_0_4px_#f4ffd8]" : "border-slate-300"
                            }`}
                          />
                        </span>
                        <span className="mt-2 block text-xs leading-5 text-[#65705d]">
                          {p.id === "claude" ? "Best for structured schema reasoning." : "Use chat completions compatible models."}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="endpoint" className={fieldLabel}>API Endpoint</label>
                  <input
                    id="endpoint"
                    type="text"
                    value={endpoint}
                    onChange={(e) => {
                      setEndpoint(e.target.value);
                      setTestResult(null);
                    }}
                    placeholder={getDefaultEndpoint(provider)}
                    className={inputClass}
                  />
                  <p className={fieldHelp}>Default: {getDefaultEndpoint(provider)}</p>
                </div>

                <div>
                  <label htmlFor="api-key" className={fieldLabel}>API Key</label>
                  <div className="flex gap-2">
                    <input
                      id="api-key"
                      type={showKey ? "text" : "password"}
                      value={apiKey}
                      onChange={(e) => {
                        setApiKey(e.target.value);
                        setTestResult(null);
                      }}
                      placeholder={keyPlaceholder}
                      className={inputClass}
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="h-11 shrink-0 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-[#c5ff4a]/35"
                    >
                      {showKey ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>

                <div>
                  <label htmlFor="model" className={fieldLabel}>Model</label>
                  <input
                    id="model"
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={getDefaultModel(provider)}
                    className={inputClass}
                  />
                  <p className={fieldHelp}>Default: {getDefaultModel(provider)}</p>
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t border-[#d8dec9] pt-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-h-10">
                  {testResult === "success" && (
                    <p className="rounded-md border border-[#c5ff4a] bg-[#f4ffd8] px-3 py-2 text-sm font-medium text-[#456000]">
                      Connection successful. The current credentials are valid.
                    </p>
                  )}
                  {testResult === "fail" && (
                    <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                      {testError || "Connection failed. Check the key, endpoint, and model name."}
                    </p>
                  )}
                </div>

                <div className="flex gap-2 sm:justify-end">
                  <button
                    type="button"
                    onClick={handleTest}
                    disabled={!canSubmit || testing}
                    className="h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-[#c5ff4a]/35 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {testing ? "Testing..." : "Test Connection"}
                  </button>
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="h-11 rounded-md bg-[#c5ff4a] px-5 text-sm font-semibold text-[#272727] shadow-sm transition hover:bg-[#b7f03f] focus:outline-none focus:ring-4 focus:ring-[#c5ff4a]/35 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {saved ? "Saved" : "Save Settings"}
                  </button>
                </div>
              </div>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
