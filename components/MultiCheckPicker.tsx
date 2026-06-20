"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";

export type PickerItem = { id: string; label: string; sublabel?: string };

type Props = {
  /** Form field name. Submitted as multiple values (FormData.getAll(name)). */
  name: string;
  items: PickerItem[];
  defaultChecked?: string[];
  placeholder?: string;
  /** Optional label shown above the picker. */
  legend?: string;
  /** Cap visible items to this many until the user searches. */
  initialMax?: number;
};

/**
 * Searchable multi-select using native checkboxes so it works inside Server
 * Action forms without extra client-side form state.
 */
export default function MultiCheckPicker({
  name,
  items,
  defaultChecked = [],
  placeholder = "Search...",
  legend,
  initialMax = 50,
}: Props) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaultChecked));

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return items.slice(0, initialMax);
    return items.filter(
      (it) =>
        it.label.toLowerCase().includes(term) ||
        (it.sublabel?.toLowerCase().includes(term) ?? false),
    );
  }, [q, items, initialMax]);

  const toggle = (id: string, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const selectVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      visible.forEach((it) => next.add(it.id));
      return next;
    });

  const clearAll = () => setSelected(new Set());

  // Items selected but not currently visible — submit via hidden inputs so
  // FormData round-trips them even when the user has filtered the list.
  const hiddenSelected = useMemo(() => {
    const visibleIds = new Set(visible.map((v) => v.id));
    return Array.from(selected).filter((id) => !visibleIds.has(id));
  }, [selected, visible]);

  // Rendered chip tray: every currently-selected item, label resolved against
  // the full items list (covers selections hidden behind the search filter).
  const selectedItems = useMemo(() => {
    const byId = new Map(items.map((it) => [it.id, it]));
    return Array.from(selected)
      .map((id) => byId.get(id))
      .filter((it): it is PickerItem => !!it)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [items, selected]);

  const countText = q
    ? `${visible.length} match${visible.length === 1 ? "" : "es"}`
    : items.length > initialMax
      ? `Showing first ${initialMax} of ${items.length} — type to search`
      : `${items.length} option${items.length === 1 ? "" : "s"}`;

  return (
    <fieldset className="picker-fieldset">
      {legend && <legend>{legend}</legend>}

      <div className="picker-head">
        <div className="picker-search">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
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
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={placeholder}
            aria-label={legend ?? "search"}
          />
        </div>
        <span className="picker-badge" data-empty={selected.size === 0 ? "true" : "false"}>
          {selected.size} selected
        </span>
      </div>

      <div className="picker-meta">
        <p className="picker-count">{countText}</p>
        <div className="picker-actions">
          <button
            type="button"
            className="ghost-button picker-mini"
            onClick={selectVisible}
            disabled={visible.length === 0}
          >
            Select visible
          </button>
          <button
            type="button"
            className="ghost-button picker-mini"
            onClick={clearAll}
            disabled={selected.size === 0}
          >
            Clear
          </button>
        </div>
      </div>

      {hiddenSelected.map((id) => (
        <input key={`hidden-${id}`} type="hidden" name={name} value={id} />
      ))}

      {selectedItems.length > 0 && (
        <div className="picker-chips" role="list" aria-label="Currently selected">
          {selectedItems.map((it) => (
            <span key={`chip-${it.id}`} className="picker-chip" role="listitem">
              <span className="picker-chip-label">{it.label}</span>
              <button
                type="button"
                className="picker-chip-remove"
                aria-label={`Remove ${it.label}`}
                onClick={() => toggle(it.id, false)}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}

      <ul className="picker-list">
        {visible.length === 0 && <li className="picker-empty">No matches.</li>}
        {visible.map((it) => (
          <li key={it.id}>
            <label>
              <input
                type="checkbox"
                name={name}
                value={it.id}
                checked={selected.has(it.id)}
                onChange={(e) => toggle(it.id, e.target.checked)}
              />
              <span>
                <span className="picker-label">{it.label}</span>
                {it.sublabel ? <span className="picker-sublabel">{it.sublabel}</span> : null}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
