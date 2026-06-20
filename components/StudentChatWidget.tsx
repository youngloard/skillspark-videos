"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { MessageCircle } from "lucide-react";
import { runStudentChatTurn } from "@/actions/ai-chat";

// Mirror of GeminiContent without importing server-only deps. The server
// action validates anything we send back, so this is a structural hint only.
// Loose shape matching server-side GeminiContent. Student bot never uses tool
// calls, but the type stays open so the server-action return value assigns.
type Part = Record<string, unknown>;
type Content = { role: "user" | "model"; parts: Part[] };

type Msg = { id: string; role: "user" | "bot" | "error"; text: string };

function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const WELCOME: Msg = {
  id: "welcome",
  role: "bot",
  text:
    "Hi! I can help with using SkillSpark — finding courses, why a video might be locked, downloading notes, and so on. What's up?",
};

export default function StudentChatWidget({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<Content[]>([]);
  const [messages, setMessages] = useState<Msg[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!bodyRef.current) return;
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, pending, open]);

  const send = useCallback(
    (text: string) => {
      const userMessage = text.trim();
      if (!userMessage || pending) return;
      setInput("");
      setMessages((m) => [...m, { id: newId(), role: "user", text: userMessage }]);
      startTransition(async () => {
        const res = await runStudentChatTurn({ history, userMessage });
        if (!res.ok) {
          setMessages((m) => [...m, { id: newId(), role: "error", text: res.error }]);
          return;
        }
        setHistory((h) => [...h, ...res.newContents]);
        setMessages((m) => [...m, { id: newId(), role: "bot", text: res.reply }]);
      });
    },
    [history, pending],
  );

  if (!enabled) return null;

  return (
    <>
      <button
        type="button"
        className="sx-chat-fab"
        aria-label={open ? "Close help chat" : "Open help chat"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <MessageCircle size={24} aria-hidden="true" />
      </button>

      {open && (
        <div className="sx-chat" role="dialog" aria-label="Help chat">
          <div className="sx-chat-head">
            <strong>SkillSpark help</strong>
            <button
              type="button"
              className="sx-chat-close"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div className="sx-chat-body" ref={bodyRef}>
            {messages.map((m) => (
              <div
                key={m.id}
                className={
                  m.role === "user"
                    ? "sx-chat-msg sx-chat-msg--user"
                    : m.role === "error"
                      ? "sx-chat-msg sx-chat-msg--error"
                      : "sx-chat-msg sx-chat-msg--bot"
                }
              >
                {m.text}
              </div>
            ))}
            {pending && (
              <div className="sx-chat-msg sx-chat-msg--bot">
                <em>thinking…</em>
              </div>
            )}
          </div>
          <form
            className="sx-chat-form"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question…"
              disabled={pending}
              maxLength={500}
            />
            <button type="submit" className="sx-btn" disabled={pending || !input.trim()}>
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}
