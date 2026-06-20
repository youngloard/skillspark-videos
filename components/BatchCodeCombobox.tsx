"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Plus, Search } from "lucide-react";

export type BatchOption = {
  /** Always the batchCode — that's what the form submits. */
  code: string;
  /** Friendly name shown as secondary text. */
  name?: string;
};

type Props = {
  /** Form field name. Submitted value is the typed/selected batchCode. */
  name: string;
  options: BatchOption[];
  defaultValue?: string;
  placeholder?: string;
  /** Optional hint shown below the field. */
  hint?: string;
};

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Combobox: type a batch code OR pick from existing.
 *
 * UX:
 *   - Always free-typable input. Form submits the literal text.
 *   - Focus / chevron click opens a popup with the filtered batch list.
 *   - As the admin types, list narrows; if the typed value doesn't match any
 *     existing batchCode, a "+ Create new: <value>" option shows at the top.
 *   - Click an option → input becomes that code (popup closes).
 *   - Press Enter on the highlighted option does the same. Escape closes.
 *
 * The action that consumes this field (`createStudent` / `updateStudent`) is
 * already capable of auto-creating an unknown batchCode on save, so picking
 * vs. creating is the same from the backend's perspective.
 */
export default function BatchCodeCombobox({
  name,
  options,
  defaultValue = "",
  placeholder = "Type or pick a batch code",
  hint,
}: Props) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, maxHeight: 320 });

  const wrapperRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => setMounted(true), []);

  const trimmed = value.trim();
  const filtered = useMemo(() => {
    const term = trimmed.toLowerCase();
    if (!term) return options;
    return options.filter(
      (o) =>
        o.code.toLowerCase().includes(term) ||
        (o.name?.toLowerCase().includes(term) ?? false),
    );
  }, [options, trimmed]);

  // Exact match exists? If not (and the user typed something), show the
  // "create new" pseudo-option at the top.
  const exactMatch = useMemo(
    () =>
      trimmed.length > 0 &&
      options.some((o) => o.code.toLowerCase() === trimmed.toLowerCase()),
    [options, trimmed],
  );
  const showCreate = trimmed.length > 0 && !exactMatch;

  const recompute = useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const margin = 12;
    const gap = 6;
    const popupWidth = Math.max(rect.width, 260);
    const roomBelow = vh - rect.bottom - margin;
    const maxHeight = Math.max(180, roomBelow - gap);
    const maxLeft = vw - popupWidth - margin;
    const left = Math.max(margin, Math.min(rect.left, maxLeft));
    setPos({
      top: rect.bottom + gap,
      left,
      width: rect.width,
      maxHeight,
    });
  }, []);

  useIsoLayoutEffect(() => {
    if (open) recompute();
  }, [open, recompute]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => recompute();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, recompute]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapperRef.current?.contains(t)) return;
      if (popupRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        inputRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (code: string) => {
    setValue(code);
    setOpen(false);
    setActiveIdx(-1);
    // NB: we do NOT refocus the input here. Refocusing would fire onFocus,
    // which calls setOpen(true) and immediately re-opens the popup — the
    // user perceives the click as a no-op. The input keeps its existing
    // focus naturally because clicking an item in a portaled, non-focusable
    // <li> doesn't move focus away.
  };

  // Build the visual list: optional "create new" pseudo + filtered options.
  type Row =
    | { kind: "create"; value: string }
    | { kind: "option"; code: string; name?: string };
  const rows: Row[] = useMemo(() => {
    const r: Row[] = [];
    if (showCreate) r.push({ kind: "create", value: trimmed });
    for (const o of filtered) r.push({ kind: "option", code: o.code, name: o.name });
    return r;
  }, [showCreate, trimmed, filtered]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      setActiveIdx((i) => Math.min(rows.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      const r = rows[activeIdx];
      if (r) {
        e.preventDefault();
        choose(r.kind === "create" ? r.value : r.code);
      }
      // No active row: leave the typed value as-is, just close.
      else if (open) setOpen(false);
    }
  };

  const popup = open ? (
    <div
      ref={popupRef}
      className="combobox-popup"
      role="presentation"
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        minWidth: pos.width,
        maxHeight: pos.maxHeight,
      }}
    >
      <ul className="combobox-list" role="listbox" id={listId} tabIndex={-1}>
        {rows.length === 0 && (
          <li className="combobox-empty" aria-disabled="true">
            No batches yet. Type a code to create the first one.
          </li>
        )}
        {rows.map((r, i) => {
          const isActive = i === activeIdx;
          // onMouseDown preventDefault keeps the input focused so the
          // subsequent click reliably fires on the <li>. Without this, some
          // browsers blur the input on mousedown, the document-level
          // mousedown listener may fire before our click handler, and the
          // popup can race-close before the option is selected.
          if (r.kind === "create") {
            return (
              <li
                key="__create"
                role="option"
                aria-selected={false}
                data-active={isActive}
                data-kind="create"
                onMouseEnter={() => setActiveIdx(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  choose(r.value);
                }}
              >
                <Plus size={14} aria-hidden="true" />
                <span className="combobox-opt-label">
                  Use new code
                  <span className="combobox-opt-hint">
                    {r.value} — created on save
                  </span>
                </span>
              </li>
            );
          }
          const isSelected = r.code.toLowerCase() === trimmed.toLowerCase();
          return (
            <li
              key={r.code}
              role="option"
              aria-selected={isSelected}
              data-active={isActive}
              data-selected={isSelected}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                choose(r.code);
              }}
            >
              <span className="combobox-opt-label">
                {r.code}
                {r.name && r.name !== r.code ? (
                  <span className="combobox-opt-hint">{r.name}</span>
                ) : null}
              </span>
              {isSelected ? <Check size={14} strokeWidth={2.6} aria-hidden="true" /> : null}
            </li>
          );
        })}
      </ul>
    </div>
  ) : null;

  return (
    <span className="combobox" ref={wrapperRef} data-open={open}>
      <span className="combobox-input-wrap">
        <Search
          className="combobox-search-icon"
          size={14}
          strokeWidth={2.2}
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="text"
          className="combobox-input"
          name={name}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
            setActiveIdx(0);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={placeholder}
          autoComplete="off"
          maxLength={64}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
        />
        <button
          type="button"
          className="combobox-chevron"
          onClick={() => {
            setOpen((o) => !o);
            inputRef.current?.focus();
          }}
          aria-label={open ? "Close suggestions" : "Open suggestions"}
          tabIndex={-1}
        >
          <ChevronDown size={16} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </span>
      {hint ? <small className="form-hint">{hint}</small> : null}
      {mounted && popup ? createPortal(popup, document.body) : null}
    </span>
  );
}
