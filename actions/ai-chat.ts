"use server";

/**
 * Server actions for the AI assistant.
 *
 *   runAdminChatTurn — drives Gemini's function-calling loop on behalf of an
 *     authenticated admin. Executes tool calls, threads results back, and
 *     returns both the raw conversation deltas (to extend client-side
 *     history) and a UI-friendly event list.
 *
 *   runStudentChatTurn — no-tools Q&A. Locked-down system prompt; refuses
 *     anything outside LMS help topics. No access to student records.
 */

import { withAdmin, type R } from "./_shared";
import { requireStudent, AuthError } from "@/lib/authorization";
import {
  geminiGenerate,
  GeminiError,
  isGeminiConfigured,
  type GeminiContent,
} from "@/lib/gemini";
import { getAdminToolDeclarations, getAdminToolHandler } from "@/lib/ai-tools";
import { parseAttachment, isParseError } from "@/lib/parse-spreadsheet";
import { z } from "zod";

const MAX_FILES_PER_TURN = 3;

// ---------- shared shapes ----------

export type ChatTurnEvent =
  | { type: "text"; text: string }
  | {
      type: "tool";
      name: string;
      args: Record<string, unknown>;
      result: { ok: boolean; data?: unknown; error?: string };
    };

export type ChatTurnResult =
  | { ok: true; newContents: GeminiContent[]; events: ChatTurnEvent[] }
  | { ok: false; error: string };

// Hard cap on tool-call iterations per turn — bounds runaway loops if the
// model keeps requesting tools that error out.
const MAX_TOOL_ITERATIONS = 8;

// Hard cap on serialized history size we'll accept from the client (defense
// in depth — the model also enforces its own context limit).
const MAX_HISTORY_BYTES = 200_000;

const contentSchema = z.array(
  z.object({
    role: z.enum(["user", "model"]),
    parts: z.array(z.any()).max(20),
  }),
);

const turnInputSchema = z.object({
  history: contentSchema.default([]),
  userMessage: z.string().trim().min(1).max(8000),
});

// ---------- admin chat ----------

const ADMIN_SYSTEM_PROMPT = `You are the SkillSpark LMS admin assistant.

You help the admin manage the learning platform: students, batches, courses, packages, and their enrollments. You have access to tools that read and modify the database — only call them when the admin asks you to *do* something or asks a question that requires looking up data.

CRITICAL RULES
- Never invent IDs, names, or codes. When unsure which record the admin means, use list_* tools to find it, then confirm before mutating.
- Required fields you don't have: ASK the admin instead of guessing. (Exception: access dates default to today and today+1y for create_student; mention the defaults you applied.)
- batchCode in create_student auto-creates the batch if missing — that is intentional, you do NOT need to call create_batch first. Tell the admin you auto-created it.
- For destructive actions (delete_*, deny_*, block, set status=inactive): confirm with the admin first ("are you sure you want to delete X?") unless they've already confirmed in this conversation.
- After completing a multi-row task (e.g. adding 5 students), give a one-sentence summary of what succeeded and what failed.

PARSING CONCATENATED INPUT (very common — handle carefully)
When the admin gives you a value where a name and a batchCode appear mashed together with no separator (e.g. "reshmionlb24", "onlb24reshmi", "AliceONLB101"), do NOT just pass the whole string as the name. Instead:
1. Call find_batch_in_text with the raw string. It returns any existing batchCodes that appear as a substring along with the leftover (remainderAfterStrippingBatchCode) and where the match sat (prefix / suffix / middle).
2. If exactly one match comes back, propose the split to the admin and CONFIRM before calling create_student. Example reply:
   "Looks like 'onlb24' is your existing batch and 'reshmi' is the name — should I add Reshmi to batch ONLB24?"
3. If multiple matches come back, list them and ask which is intended.
4. If no match comes back, ask the admin where the batchCode is in the string (or whether a new batch should be auto-created). Do NOT guess.
5. Once confirmed, call create_student with the cleaned 'name' and the resolved 'batchCode' separately. Preserve the admin's preferred casing for the display name (e.g. Reshmi not reshmi) but you may keep batchCodes uppercase.

The same logic applies to delete/find/update intents that reference a student by a mashed-together value: scan with find_batch_in_text or list_students first, then confirm.

HANDLING ATTACHED FILES (CSV / TSV / XLSX)
The admin can attach spreadsheet files. Their content arrives in your user turn as fenced code blocks under headers like "--- attached file: students.xlsx ... ---". Treat that block as data the admin wants you to act on.
- Inspect the headers and the first few rows to figure out what each column means. Don't assume — if a column is ambiguous (e.g. "code" could be studentCode or batchCode), ASK.
- If access dates aren't in the file, ask once whether to use the defaults (today / today+1y) for everyone or use specific dates.
- For unknown batchCodes referenced in the file, mention that they'll be auto-created (create_student auto-creates the batch). Don't ask once per row — ask once at the top.
- Before you start a batch of mutations from a file: summarize what you're about to do ("I'll create 12 students in batches ONLB101 and ONLB102, with access dates X to Y") and wait for the admin to say "go" or "yes".
- Then create the rows one at a time via create_student. At the end, give a one-sentence success/failure summary.

DATA MODEL CHEATSHEET
- Student access to a course requires NO denial row + at least one grant path (direct course, direct package, batch course, batch package).
- studentCode is unique alphanumeric (auto-generated if not provided).
- email is unique (lowercased).
- accessStartDate <= accessEndDate.
- Batch fields: batchCode (unique), batchName, description.
- Course fields: name (unique), description, status (active/inactive), layout (module/flat).
- Package fields: name (unique), description, status (active/inactive).

OUTPUT STYLE
- Be terse. No emojis. No markdown headings inside short replies. Lists are fine when listing many records.`;

/**
 * Accepts FormData with three fields:
 *   - history     : JSON string of prior GeminiContent[]
 *   - userMessage : string
 *   - files       : 0..N File objects (CSV / TSV / TXT / XLSX), each ≤ 2MB
 *
 * Files are parsed server-side and prepended to the user message as
 * fenced blocks the model can read directly.
 */
export async function runAdminChatTurn(formData: FormData): Promise<ChatTurnResult> {
  if (!isGeminiConfigured()) {
    return { ok: false, error: "Gemini is not configured. Set GOOGLE_GEMINI_API_KEY in .env." };
  }

  const wrapped = await withAdmin(async (admin): Promise<R<{ result: ChatTurnResult }>> => {
    // Decode FormData payload.
    let historyJSON = "[]";
    let userMessageRaw = "";
    try {
      historyJSON = String(formData.get("history") ?? "[]");
      userMessageRaw = String(formData.get("userMessage") ?? "");
    } catch {
      return { ok: true, data: { result: { ok: false, error: "invalid form data" } } };
    }
    let parsedHistory: unknown;
    try {
      parsedHistory = JSON.parse(historyJSON);
    } catch {
      return { ok: true, data: { result: { ok: false, error: "history is not valid JSON" } } };
    }

    const parsed = turnInputSchema.safeParse({
      history: parsedHistory,
      userMessage: userMessageRaw,
    });
    if (!parsed.success) {
      return { ok: true, data: { result: { ok: false, error: parsed.error.issues[0].message } } };
    }
    if (JSON.stringify(parsed.data.history).length > MAX_HISTORY_BYTES) {
      return { ok: true, data: { result: { ok: false, error: "conversation too long; start a new chat" } } };
    }

    // Parse attachments (if any).
    const allFiles = formData
      .getAll("files")
      .filter((f): f is File => f instanceof File && f.size > 0);
    if (allFiles.length > MAX_FILES_PER_TURN) {
      return {
        ok: true,
        data: {
          result: {
            ok: false,
            error: `too many attachments (max ${MAX_FILES_PER_TURN} per message)`,
          },
        },
      };
    }
    const fileBlocks: string[] = [];
    const fileErrors: string[] = [];
    for (const f of allFiles) {
      const r = await parseAttachment(f);
      if (isParseError(r)) {
        fileErrors.push(`${r.filename}: ${r.reason}`);
      } else {
        fileBlocks.push(r.asPromptText);
      }
    }

    // Combine file blocks + user message into the user turn text.
    const combinedText = [
      fileBlocks.length
        ? `${fileBlocks.join("\n\n")}\n\nThe admin wants you to act on the data above. Ask any clarifying questions before mutating the database.`
        : "",
      fileErrors.length ? `(File parse errors: ${fileErrors.join("; ")})` : "",
      parsed.data.userMessage,
    ]
      .filter(Boolean)
      .join("\n\n");

    const tools = getAdminToolDeclarations();
    const events: ChatTurnEvent[] = [];
    const newContents: GeminiContent[] = [];

    // Append the user's message (with any attached-file context inlined).
    const userTurn: GeminiContent = {
      role: "user",
      parts: [{ text: combinedText }],
    };
    newContents.push(userTurn);

    let conversation: GeminiContent[] = [
      ...(parsed.data.history as GeminiContent[]),
      userTurn,
    ];

    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      let reply: GeminiContent;
      try {
        reply = await geminiGenerate({
          systemInstruction: ADMIN_SYSTEM_PROMPT,
          contents: conversation,
          tools,
          temperature: 0.2,
        });
      } catch (e: any) {
        const msg =
          e instanceof GeminiError
            ? `Gemini error (${e.status}): ${e.details || e.message}`
            : `Gemini error: ${String(e?.message ?? e)}`;
        return { ok: true, data: { result: { ok: false, error: msg } } };
      }

      newContents.push(reply);
      conversation = [...conversation, reply];

      const toolCalls = (reply.parts ?? []).filter(
        (p): p is { functionCall: { name: string; args: Record<string, unknown> } } =>
          typeof p === "object" && p !== null && "functionCall" in p,
      );
      const textParts = (reply.parts ?? []).filter(
        (p): p is { text: string } =>
          typeof p === "object" && p !== null && "text" in p && typeof (p as any).text === "string",
      );

      // Capture any inline assistant text emitted alongside tool calls.
      for (const t of textParts) {
        if (t.text.trim()) events.push({ type: "text", text: t.text });
      }

      if (toolCalls.length === 0) {
        // Final reply — exit loop.
        return { ok: true, data: { result: { ok: true, newContents, events } } };
      }

      // Execute each tool call and ship a functionResponse part back to the
      // model. We bundle all responses into a single `function`-role content
      // so Gemini sees them as one turn.
      const responseParts: Array<{
        functionResponse: { name: string; response: Record<string, unknown> };
      }> = [];

      for (const call of toolCalls) {
        const handler = getAdminToolHandler(call.functionCall.name);
        if (!handler) {
          const result = { ok: false as const, error: `unknown tool ${call.functionCall.name}` };
          events.push({
            type: "tool",
            name: call.functionCall.name,
            args: call.functionCall.args ?? {},
            result,
          });
          responseParts.push({
            functionResponse: { name: call.functionCall.name, response: result },
          });
          continue;
        }
        let result: { ok: boolean; data?: unknown; error?: string };
        try {
          result = await handler(admin, call.functionCall.args ?? {});
        } catch (e: any) {
          result = { ok: false, error: `tool threw: ${String(e?.message ?? e).slice(0, 200)}` };
        }
        // Note: the individual tool handlers (lib/ai-tools.ts) audit each
        // entity-level mutation with `via: "ai-assistant"`. We deliberately
        // do NOT log an extra row per call here — that would double-write for
        // every mutation. Read-only tools (list_*, get_*) are not audited.
        events.push({
          type: "tool",
          name: call.functionCall.name,
          args: call.functionCall.args ?? {},
          result,
        });
        responseParts.push({
          functionResponse: {
            name: call.functionCall.name,
            response: result.ok
              ? { ok: true, data: result.data }
              : { ok: false, error: (result as { error?: string }).error ?? "failed" },
          },
        });
      }

      // Gemini REST API takes function responses as parts inside a user-role
      // content, not a dedicated "function" role.
      const fnTurn: GeminiContent = { role: "user", parts: responseParts };
      newContents.push(fnTurn);
      conversation = [...conversation, fnTurn];
    }

    // Hit iteration cap — surface a synthetic message so the UI explains the stall.
    events.push({
      type: "text",
      text: "(Reached tool-call limit for this turn. Ask the next step explicitly.)",
    });
    return { ok: true, data: { result: { ok: true, newContents, events } } };
  });

  if (!wrapped.ok) {
    return { ok: false, error: wrapped.error };
  }
  return wrapped.data!.result;
}

// ---------- student chat ----------

const STUDENT_SYSTEM_PROMPT = `You are the SkillSpark student help bot.

You help students understand how the platform works. You do NOT have access to any student records, courses, batches, or admin tools.

WHAT YOU HANDLE
- "Where do I find my courses?" → dashboard at /dashboard
- "Why can't I see a video?" → access may have expired, video may be inactive, or admin denied this course for you. Tell them to contact their admin.
- "How do I download notes?" → click the note; download is available only if the admin enabled it.
- "When does my access expire?" → tell them the date is shown on their dashboard.
- General questions about the LMS.

REFUSE POLITELY
- Anything off-topic (homework help, general programming, current events, etc.) — say you only help with SkillSpark usage.
- Anything about other students or admin actions.
- Anything asking you to do something (you have no tools).

Keep replies short — 1-3 sentences usually.`;

export type StudentChatResult =
  | { ok: true; reply: string; newContents: GeminiContent[] }
  | { ok: false; error: string };

export async function runStudentChatTurn(input: unknown): Promise<StudentChatResult> {
  if (!isGeminiConfigured()) {
    return { ok: false, error: "Gemini is not configured." };
  }
  // Auth: must be an active, in-date student.
  try {
    await requireStudent();
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }

  const parsed = turnInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  if (JSON.stringify(parsed.data.history).length > MAX_HISTORY_BYTES) {
    return { ok: false, error: "conversation too long; refresh to start over" };
  }

  const userTurn: GeminiContent = {
    role: "user",
    parts: [{ text: parsed.data.userMessage }],
  };

  let reply: GeminiContent;
  try {
    reply = await geminiGenerate({
      systemInstruction: STUDENT_SYSTEM_PROMPT,
      contents: [...(parsed.data.history as GeminiContent[]), userTurn],
      // No tools — student bot is read-only Q&A.
      temperature: 0.4,
      maxOutputTokens: 512,
    });
  } catch (e: any) {
    const msg =
      e instanceof GeminiError
        ? `Gemini error (${e.status}): ${e.details || e.message}`
        : `Gemini error: ${String(e?.message ?? e)}`;
    return { ok: false, error: msg };
  }

  const text =
    (reply.parts ?? [])
      .map((p) => ("text" in p && typeof (p as any).text === "string" ? (p as any).text : ""))
      .join("")
      .trim() || "(no reply)";

  return {
    ok: true,
    reply: text,
    newContents: [userTurn, reply],
  };
}
