"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Paperclip, RotateCcw, Send, X } from "lucide-react";
import { runAdminChatTurn, type ChatTurnEvent } from "@/actions/ai-chat";

// Loose shape matching server-side GeminiContent so the server-action return
// value assigns cleanly. We don't introspect parts client-side.
type Part = Record<string, unknown>;
type Content = { role: "user" | "model"; parts: Part[] };

type RenderedEvent =
  | { type: "user"; text: string; id: string; attachments?: { name: string; size: number }[] }
  | { type: "assistant"; text: string; id: string }
  | {
      type: "tool";
      id: string;
      name: string;
      args: Record<string, unknown>;
      result: { ok: boolean; data?: unknown; error?: string };
    }
  | { type: "error"; text: string; id: string };

function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

const PROMPT_EXAMPLES = [
  "Add a student named Alice with email alice@example.com to batch ONLB101.",
  "What courses does student S00001 have access to?",
  "Create a course called \"Power BI Basics\".",
  "Block student bob@example.com.",
  "Show me the latest 10 students.",
];

const ACCEPT_FILE_TYPES = ".csv,.tsv,.txt,.xlsx,.xls,.xlsm";
const MAX_FILES = 3;

export default function AdminAIChat() {
  const [history, setHistory] = useState<Content[]>([]);
  const [rendered, setRendered] = useState<RenderedEvent[]>([]);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [rendered, pending]);

  const send = useCallback(
    (text: string) => {
      const userMessage = text.trim();
      if ((!userMessage && files.length === 0) || pending) return;
      const attached = files.slice();
      setInput("");
      setFiles([]);
      setError(null);

      const userEvent: RenderedEvent = {
        type: "user",
        text: userMessage || "(see attached file)",
        id: newId(),
        attachments: attached.map((f) => ({ name: f.name, size: f.size })),
      };
      setRendered((r) => [...r, userEvent]);

      startTransition(async () => {
        const fd = new FormData();
        fd.set("history", JSON.stringify(history));
        fd.set("userMessage", userMessage || "Please process the attached file(s).");
        for (const f of attached) fd.append("files", f);
        const res = await runAdminChatTurn(fd);
        if (!res.ok) {
          setError(res.error);
          setRendered((r) => [...r, { type: "error", text: res.error, id: newId() }]);
          return;
        }
        setHistory((h) => [...h, ...res.newContents]);
        const turnRendered: RenderedEvent[] = res.events.map((e: ChatTurnEvent) =>
          e.type === "text"
            ? { type: "assistant", text: e.text, id: newId() }
            : {
                type: "tool",
                id: newId(),
                name: e.name,
                args: e.args,
                result: e.result,
              },
        );
        setRendered((r) => [...r, ...turnRendered]);
      });
    },
    [history, pending, files],
  );

  const clearChat = () => {
    if (pending) return;
    setHistory([]);
    setRendered([]);
    setFiles([]);
    setError(null);
  };

  const onFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (!picked.length) return;
    setFiles((prev) => {
      const merged = [...prev];
      for (const f of picked) {
        if (merged.length >= MAX_FILES) break;
        // De-dupe by name+size.
        if (!merged.some((m) => m.name === f.name && m.size === f.size)) merged.push(f);
      }
      return merged;
    });
    // Allow re-selecting the same file later.
    e.target.value = "";
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const canSend = !pending && (input.trim().length > 0 || files.length > 0);

  return (
    <div className="ai-chat">
      <div className="ai-chat-scroll" ref={scrollRef}>
        {rendered.length === 0 ? (
          <div className="ai-chat-empty">
            <h2>Ask me anything about the platform.</h2>
            <p>
              I can add, update, and remove students/batches/courses/packages, read CSV or Excel
              files you attach, and explain how the system works. Try one of these:
            </p>
            <ul>
              {PROMPT_EXAMPLES.map((p) => (
                <li key={p}>
                  <button type="button" onClick={() => send(p)}>
                    {p}
                  </button>
                </li>
              ))}
            </ul>
            <p className="ai-chat-empty-tip">
              I&rsquo;ll confirm before destructive actions (delete, deny, block).
            </p>
          </div>
        ) : (
          rendered.map((ev) => <Event key={ev.id} ev={ev} />)
        )}
        {pending && (
          <div className="ai-chat-bubble ai-chat-bubble-thinking">
            Thinking<span className="ai-chat-dots">...</span>
          </div>
        )}
      </div>

      <form
        className="ai-chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        {files.length > 0 && (
          <div className="ai-chat-attachments" role="list">
            {files.map((f, i) => (
              <span key={`${f.name}-${i}`} className="ai-chat-attachment" role="listitem">
                <Paperclip size={12} aria-hidden="true" />
                <span className="ai-chat-attachment-name">{f.name}</span>
                <span className="ai-chat-attachment-size">{fmtBytes(f.size)}</span>
                <button
                  type="button"
                  className="ai-chat-attachment-remove"
                  onClick={() => removeFile(i)}
                  aria-label={`Remove ${f.name}`}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="ai-chat-composer-row">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_FILE_TYPES}
            multiple
            onChange={onFilePick}
            style={{ display: "none" }}
          />
          <button
            type="button"
            className="ai-chat-icon-btn ai-chat-icon-btn-attach"
            onClick={() => fileInputRef.current?.click()}
            disabled={pending || files.length >= MAX_FILES}
            aria-label="Attach file"
            title={files.length >= MAX_FILES ? `Up to ${MAX_FILES} files` : "Attach CSV / Excel"}
          >
            <Paperclip size={18} aria-hidden="true" />
          </button>
          <textarea
            rows={1}
            name="message"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask anything, or attach a CSV / Excel file…"
            disabled={pending}
          />
          <button
            type="button"
            className="ai-chat-icon-btn"
            onClick={clearChat}
            disabled={pending || (rendered.length === 0 && files.length === 0 && !input)}
            aria-label="Clear chat"
            title="Clear chat"
          >
            <RotateCcw size={18} aria-hidden="true" />
          </button>
          <button
            type="submit"
            className="ai-chat-icon-btn ai-chat-icon-btn-primary"
            disabled={!canSend}
            aria-label="Send message"
            title="Send (Enter)"
          >
            <Send size={18} aria-hidden="true" />
          </button>
        </div>
      </form>

      {error && <p className="ai-chat-error">{error}</p>}
    </div>
  );
}

function Event({ ev }: { ev: RenderedEvent }) {
  if (ev.type === "user") {
    return (
      <div className="ai-chat-bubble ai-chat-bubble-user">
        <span className="ai-chat-role">You</span>
        {ev.attachments && ev.attachments.length > 0 && (
          <div className="ai-chat-bubble-attachments">
            {ev.attachments.map((a, i) => (
              <span key={`${a.name}-${i}`} className="ai-chat-bubble-attachment">
                <Paperclip size={11} aria-hidden="true" /> {a.name} <em>({fmtBytes(a.size)})</em>
              </span>
            ))}
          </div>
        )}
        <p>{ev.text}</p>
      </div>
    );
  }
  if (ev.type === "assistant") {
    return (
      <div className="ai-chat-bubble ai-chat-bubble-assistant">
        <span className="ai-chat-role">Assistant</span>
        <p style={{ whiteSpace: "pre-wrap" }}>{ev.text}</p>
      </div>
    );
  }
  if (ev.type === "error") {
    return (
      <div className="ai-chat-bubble ai-chat-bubble-error">
        <span className="ai-chat-role">Error</span>
        <p>{ev.text}</p>
      </div>
    );
  }
  // tool
  return (
    <details className={`ai-chat-tool ${ev.result.ok ? "ai-chat-tool-ok" : "ai-chat-tool-fail"}`}>
      <summary>
        <code>{ev.name}</code>
        {ev.result.ok ? " — ok" : ` — failed: ${ev.result.error ?? "unknown"}`}
      </summary>
      <div className="ai-chat-tool-body">
        <strong>args</strong>
        <pre>{JSON.stringify(ev.args, null, 2)}</pre>
        <strong>{ev.result.ok ? "result" : "error"}</strong>
        <pre>
          {ev.result.ok
            ? JSON.stringify(ev.result.data, null, 2)
            : ev.result.error}
        </pre>
      </div>
    </details>
  );
}
