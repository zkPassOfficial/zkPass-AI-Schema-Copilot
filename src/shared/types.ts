export interface CapturedRequest {
  id: string;
  url: string;
  method: string;
  status: number;
  requestHeaders: Record<string, string>;
  requestBody?: string | null;
  responseHeaders: Record<string, string>;
  responseBody: string;
  contentType: string;
  timestamp: number;
  tabId: number;
  origin: string;
  sourceType?: "json" | "html";
  pageUrl?: string;
}

export interface IndexedField {
  path: string;
  type: "string" | "number" | "boolean" | "null" | "array" | "object";
  sampleValue: string;
  depth: number;
}

export interface ApiCandidateSummary {
  id: string;
  url: string;
  method: string;
  host: string;
  pathname: string;
  requestHeaders?: Record<string, string>;
  requestBody?: string | null;
  fields: IndexedField[];
  sourceType?: "json" | "html";
  capturedAt?: number;
}

export interface AssertionItem {
  key: string;
  value: string;
  operation: string;
  tips?: string;
  isPublic?: boolean;
}

export interface ApiSelection {
  apiId: string;
  assertions: AssertionItem[];
  nullifier?: string | null;
  sourceType?: "html";
  lookupEndpointIndex?: number;
}

export interface MissingDataItem {
  what: string;
  suggestedPages: string[];
  exampleFieldNames?: string[];
}

export interface MissingDataResult {
  status: "missing_data";
  message: string;
  missing: MissingDataItem[];
}

export interface AnalysisResult {
  status: "analysis";
  understanding: {
    facts: string[];
    assumptions: string[];
    questions: string[];
  };
  message: string;
  readyToBuild: boolean;
}

export interface AiMatchResult {
  selectedApi: string;
  nullifierApi?: string;
  fieldPath: string;
  assertions: AssertionItem[];
  nullifier: string | null;
  confidence: number;
  reason: string;
  HRCondition: string[];
  website?: string;
  sourceType?: "html";
  httpVersion?: string;
  apis?: ApiSelection[];
}

export interface ZkPassSchema {
  website: string;
  httpVersion?: string;
  APIs: Array<{
    host: string;
    accept?: string;
    intercept: {
      url: string;
      method: "GET" | "POST";
      query?: Array<Record<string, unknown> & { verify?: boolean }>;
      header?: Array<Record<string, unknown> & { verify?: boolean }>;
      body?: Array<Record<string, unknown> & { verify?: boolean }>;
    };
    override?: {
      url?: string;
      query?: Array<Record<string, unknown> & { verify?: boolean }>;
      header?: Array<Record<string, unknown> & { verify?: boolean }>;
      body?: Array<Record<string, unknown> & { verify?: boolean }>;
    };
    referred?: string[];
    assert?: Array<{
      key: string;
      value: string;
      operation: string;
      tips?: string;
      isPublic?: boolean;
    }>;
    nullifier?: string;
  }>;
  HRCondition: string[];
  tips?: { message: string };
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  rawAiContent?: string;
  timestamp: number;
  metadata?: {
    candidatePreview?: ApiCandidateSummary;
    schema?: ZkPassSchema;
    confidence?: number;
    aiResult?: AiMatchResult;
    capturedApis?: ApiCandidateSummary[];
  };
}

export interface ExtensionMessage<T = unknown> {
  type: string;
  payload?: T;
}
