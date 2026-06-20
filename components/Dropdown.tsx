"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, X } from "lucide-react";

export type DropdownOption = {
  value: string;
  label: string;
  hint?: string;
};

type Props = {
  name: string;
  options: DropdownOption[];
  defaultValue?: string;
  placeholder?: string;
  /** Optional label shown to the left of the trigger. */
  label?: string;
  /** Force-show search field. Auto-on for >8 options. */
  searchable?: boolean;
  /** Min trigger width (px). */
  minWidth?: number;
  /** ARIA label if no visual label is provided. */
  ariaLabel?: string;
};

type Pos = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: "top" | "bottom";
};

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export default function Dropdown({
  name,
  options,
  defaultValue = "",
  placeholder = "Select…",
  label,
  searchable,
  minWidth = 180,
  ariaLabel,
}: Props) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [activeIdx, setActiveIdx] = useState(-1);
  const [pos, setPos] = useState<Pos>({
    top: 0,
    left: 0,
    width: 0,
    maxHeight: 320,
    placement: "bottom",
  });
  const [mounted, setMounted] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => setMounted(true), []);

  const showSearch = searchable ?? options.length > 8;
  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    if (!q.trim()) return options;
    const term = q.trim().toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(term) ||
        (o.hint?.toLowerCase().includes(term) ?? false),
    );
  }, [q, options]);

  const recompute = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const popupWidth =
      popupRef.current?.offsetWidth ?? Math.max(rect.width, 220);
    const margin = 12;
    const gap = 8;

    // Always anchor below the trigger. If the trigger sits near the bottom
    // of the viewport, the popup's internal list scrolls within whatever
    // room remains (clamped to a usable minimum).
    const roomBelow = vh - rect.bottom - margin;
    const maxHeight = Math.max(160, roomBelow - gap);

    const maxLeft = vw - popupWidth - margin;
    const left = Math.max(margin, Math.min(rect.left, maxLeft));

    setPos({
      top: rect.bottom + gap,
      left,
      width: rect.width,
      maxHeight,
      placement: "bottom",
    });
  };

  useIsoLayoutEffect(() => {
    if (open) recompute();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => recompute();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

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
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open && showSearch) {
      const t = window.setTimeout(() => searchRef.current?.focus(), 30);
      return () => window.clearTimeout(t);
    }
    if (!open) {
      setQ("");
      setActiveIdx(-1);
    }
  }, [open, showSearch]);

  const choose = (v: string) => {
    setValue(v);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = filtered[activeIdx] ?? filtered[0];
      if (target) choose(target.value);
    }
  };

  const popup = open ? (
    <div
      ref={popupRef}
      className="dropdown-popup"
      data-placement={pos.placement}
      role="presentation"
      onKeyDown={onListKey}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        minWidth: pos.width,
        maxHeight: pos.maxHeight,
      }}
    >
      {showSearch && (
        <div className="dropdown-search">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-4.35-4.35M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z"
            />
          </svg>
          <input
            ref={searchRef}
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActiveIdx(0);
            }}
            placeholder="Search…"
            aria-label="Search options"
            autoComplete="off"
          />
        </div>
      )}
      <ul className="dropdown-list" role="listbox" id={listId} tabIndex={-1}>
        {filtered.length === 0 && (
          <li className="dropdown-empty" aria-disabled="true">
            No matches
          </li>
        )}
        {filtered.map((opt, i) => {
          const isSelected = opt.value === value;
          const isActive = i === activeIdx;
          return (
            <li
              key={opt.value || `__opt_${i}`}
              role="option"
              aria-selected={isSelected}
              data-active={isActive}
              data-selected={isSelected}
              onMouseEnter={() => setActiveIdx(i)}
              onClick={() => choose(opt.value)}
            >
              <span className="dropdown-opt-label">
                {opt.label}
                {opt.hint ? (
                  <span className="dropdown-opt-hint">{opt.hint}</span>
                ) : null}
              </span>
              {isSelected ? (
                <Check size={14} strokeWidth={2.6} aria-hidden="true" />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  ) : null;

  // Treat an option whose value is "" as the "no selection" sentinel — when
  // the user picks it via the popup it counts as a clear, and the inline X
  // should not be offered for it (would be a no-op).
  const hasClearable = !!value && !!selected;
  const clearSelection = (e: React.MouseEvent) => {
    e.stopPropagation();
    setValue("");
    triggerRef.current?.focus();
  };

  return (
    <span className="dropdown" ref={wrapperRef} data-open={open}>
      {label && <span className="dropdown-label">{label}</span>}
      <input type="hidden" name={name} value={value} />
      <button
        ref={triggerRef}
        type="button"
        className="dropdown-trigger"
        data-has-value={hasClearable ? "true" : undefined}
        style={{ minWidth }}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel ?? label ?? placeholder}
      >
        <span className={selected ? "dropdown-value" : "dropdown-placeholder"}>
          {selected?.label ?? placeholder}
        </span>
        <span className="dropdown-actions">
          {hasClearable && (
            <span
              role="button"
              tabIndex={0}
              className="dropdown-clear"
              onClick={clearSelection}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  setValue("");
                  triggerRef.current?.focus();
                }
              }}
              aria-label={`Clear selection${selected ? ` (${selected.label})` : ""}`}
              title="Clear"
            >
              <X size={14} strokeWidth={2.4} aria-hidden="true" />
            </span>
          )}
          <ChevronDown
            className="dropdown-chevron"
            size={16}
            strokeWidth={2.4}
            aria-hidden="true"
          />
        </span>
      </button>
      {mounted && popup ? createPortal(popup, document.body) : null}
    </span>
  );
}
