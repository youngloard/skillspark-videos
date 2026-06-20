"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle2, X } from "lucide-react";

type Tone = "success" | "error";
type ToastItem = { id: number; message: string; tone: Tone };

type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Access the toast API. Must be called from a component rendered inside
 * `<ToastProvider>` (mounted once in AdminShell, so every admin page + every
 * client component under it can fire confirmations).
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a <ToastProvider>");
  }
  return ctx;
}

const DISMISS_MS = 3800;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [mounted, setMounted] = useState(false);
  const idRef = useRef(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  // Portal target only exists on the client; gate the portal on mount so SSR
  // and the first client render agree (no hydration mismatch).
  useEffect(() => {
    setMounted(true);
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const remove = useCallback((id: number) => {
    setItems((xs) => xs.filter((t) => t.id !== id));
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (message: string, tone: Tone) => {
      const id = (idRef.current += 1);
      setItems((xs) => [...xs, { id, message, tone }]);
      timers.current.set(
        id,
        setTimeout(() => remove(id), DISMISS_MS),
      );
    },
    [remove],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push(m, "success"),
      error: (m) => push(m, "error"),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {mounted &&
        createPortal(
          <div
            className="toast-stack"
            role="region"
            aria-live="polite"
            aria-label="Notifications"
          >
            {items.map((t) => (
              <div key={t.id} className="toast" data-tone={t.tone} role="status">
                <span className="toast-icon" aria-hidden="true">
                  {t.tone === "success" ? (
                    <CheckCircle2 size={18} strokeWidth={2.4} />
                  ) : (
                    <AlertCircle size={18} strokeWidth={2.4} />
                  )}
                </span>
                <span className="toast-msg">{t.message}</span>
                <button
                  type="button"
                  className="toast-close"
                  onClick={() => remove(t.id)}
                  aria-label="Dismiss notification"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}
