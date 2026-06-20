"use client";

/**
 * One module section on the student course page that can be expanded /
 * collapsed. Built on the native <details> element so it works without
 * JS (progressive enhancement) and keeps focus / keyboard semantics for
 * free. The chevron rotation + body fade are pure CSS, driven by the
 * `open` attribute on <details>.
 */
import { ChevronDown, Check } from "lucide-react";
import { useEffect, useRef } from "react";

type Props = {
  index: number;
  title: string;
  description?: string | null;
  lessonCount: number;
  completed: boolean;
  /** Whether to render expanded on first paint. */
  defaultOpen?: boolean;
  children: React.ReactNode;
};

export default function CollapsibleModule({
  index,
  title,
  description,
  lessonCount,
  completed,
  defaultOpen = false,
  children,
}: Props) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  // Persist open/closed state across navigations within the same browser
  // session. Keyed by index + title so a course-level reorder doesn't
  // restore stale state from a different module.
  const key = `lms.module.${index}.${title}`;
  useEffect(() => {
    if (!detailsRef.current) return;
    const stored = window.sessionStorage.getItem(key);
    if (stored === "1") detailsRef.current.open = true;
    else if (stored === "0") detailsRef.current.open = false;
    // First time we see this module: honor the prop default.
    else detailsRef.current.open = defaultOpen;

    const el = detailsRef.current;
    const onToggle = () => {
      try {
        window.sessionStorage.setItem(key, el.open ? "1" : "0");
      } catch {
        /* sessionStorage unavailable (private mode etc.) — silently ignore */
      }
    };
    el.addEventListener("toggle", onToggle);
    return () => el.removeEventListener("toggle", onToggle);
  }, [key, defaultOpen]);

  return (
    <details
      ref={detailsRef}
      className="sx-mod"
      data-complete={completed ? "true" : undefined}
    >
      <summary className="sx-mod-summary">
        <span
          className="sx-mod-index"
          data-complete={completed ? "true" : undefined}
          aria-hidden="true"
        >
          {completed ? (
            <Check size={18} strokeWidth={2.6} />
          ) : (
            String(index + 1).padStart(2, "0")
          )}
        </span>
        <span className="sx-mod-titles">
          <span className="sx-eyebrow">Module {index + 1}</span>
          <span className="sx-mod-title">{title}</span>
          {description ? (
            <span className="sx-mod-desc">{description}</span>
          ) : null}
        </span>
        <span className="sx-mod-meta">
          <span className="sx-count">
            {lessonCount} lesson{lessonCount === 1 ? "" : "s"}
          </span>
          <ChevronDown
            className="sx-mod-chev"
            size={18}
            strokeWidth={2.4}
            aria-hidden="true"
          />
        </span>
      </summary>
      <div className="sx-mod-body">{children}</div>
    </details>
  );
}
