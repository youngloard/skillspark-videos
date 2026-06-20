/**
 * Minimal Gemini REST client.
 *
 * Why hand-rolled instead of `@google/genai`: the SDK pulls in a stack of
 * deps we don't otherwise need, and the function-calling REST surface is
 * small. Direct fetch keeps the bundle and the failure modes simple.
 *
 * Function-calling loop (caller's responsibility): send `contents`, inspect
 * the model's reply for `functionCall` parts, execute them, append a
 * `functionResponse` part, call again. Repeat until the model returns text.
 */
import "server-only";

export type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

export type GeminiContent = {
  /** Gemini REST API accepts only "user" or "model" here. Function responses
   *  are encoded as parts inside a user-role content. */
  role: "user" | "model";
  parts: GeminiPart[];
};

export type GeminiToolDeclaration = {
  name: string;
  description: string;
  /** OpenAPI-subset JSON Schema. Gemini accepts the same shape as OpenAI tools. */
  parameters: Record<string, unknown>;
};

const DEFAULT_MODEL = "gemini-2.0-flash";

function model(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

function endpoint(): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model()}:generateContent`;
}

export function isGeminiConfigured(): boolean {
  return !!process.env.GOOGLE_GEMINI_API_KEY?.trim();
}

export class GeminiError extends Error {
  status: number;
  details: string;
  constructor(message: string, status: number, details: string) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/**
 * Single generation call. Returns the model's reply `content` (role=model)
 * with one or more parts. Caller drives the tool loop.
 */
export async function geminiGenerate(opts: {
  systemInstruction?: string;
  contents: GeminiContent[];
  tools?: GeminiToolDeclaration[];
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<GeminiContent> {
  const key = process.env.GOOGLE_GEMINI_API_KEY?.trim();
  if (!key) {
    throw new GeminiError(
      "Gemini API key not configured",
      500,
      "Set GOOGLE_GEMINI_API_KEY in .env",
    );
  }

  const body: Record<string, unknown> = {
    contents: opts.contents,
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
      maxOutputTokens: opts.maxOutputTokens ?? 2048,
    },
  };
  if (opts.systemInstruction) {
    body.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
  }
  if (opts.tools?.length) {
    body.tools = [{ functionDeclarations: opts.tools }];
    body.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
  }

  let res: Response;
  try {
    res = await fetch(`${endpoint()}?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // Don't let Next cache LLM calls; every turn is unique.
      cache: "no-store",
    });
  } catch (e: any) {
    throw new GeminiError("Gemini network error", 502, String(e?.message ?? e));
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new GeminiError(`Gemini ${res.status}`, res.status, text.slice(0, 1000));
  }

  const data = (await res.json().catch(() => null)) as
    | { candidates?: Array<{ content?: GeminiContent; finishReason?: string }> }
    | null;
  if (!data?.candidates?.length) {
    throw new GeminiError("Gemini empty response", 502, JSON.stringify(data).slice(0, 500));
  }
  const candidate = data.candidates[0]!;
  // Defensive: if the model truly returned nothing, surface as an empty text part
  // so the caller's tool loop terminates rather than infinite-looping.
  if (!candidate.content) {
    return { role: "model", parts: [{ text: "" }] };
  }
  return candidate.content;
}
