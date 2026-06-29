"use client";

import { useEffect, useState } from "react";

/**
 * A real 0 → 100% loading meter for route-transition `loading.tsx` fallbacks.
 *
 * A `loading.tsx` is static SSR HTML, so a CSS-only bar can't actually count up
 * — and a CSS animation gets frozen by `prefers-reduced-motion`. This drives the
 * percentage in JS (requestAnimationFrame → state), so it visibly climbs 0→100
 * everywhere. The fallback is swapped for the real page as soon as it's ready,
 * which usually happens partway up; on a slow page it eases to 100 and holds.
 */
export default function ProgressLoader({
  label = "Loading…",
  value,
}: {
  label?: string;
  /** Controlled 0-100 percentage. If omitted, the meter self-animates 0→100. */
  value?: number;
}) {
  const [selfPct, setSelfPct] = useState(0);
  const controlled = typeof value === "number";
  const pct = controlled ? Math.max(0, Math.min(100, Math.round(value!))) : selfPct;

  useEffect(() => {
    if (controlled) return;
    const DURATION = 1000; // ms to climb 0 → 100
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      const eased = 1 - Math.pow(1 - t, 2); // ease-out
      setSelfPct(Math.round(eased * 100));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [controlled]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      style={{
        minHeight: "70dvh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
      }}
    >
      <div style={{ display: "grid", justifyItems: "center", gap: 16, width: "min(280px, 80vw)", textAlign: "center" }}>
        <span
          aria-hidden="true"
          style={{
            display: "grid",
            placeItems: "center",
            width: 56,
            height: 56,
            borderRadius: 16,
            color: "#f6f4ec",
            background: "#1c1a15",
            font: '600 1.6rem/1 "Fraunces", Georgia, serif',
          }}
        >
          S
        </span>
        <span style={{ fontWeight: 600, color: "#1c1a15", fontSize: "0.95rem" }}>{label}</span>

        <div style={{ width: "100%", display: "grid", gap: 8 }}>
          <div
            style={{
              position: "relative",
              height: 6,
              borderRadius: 999,
              background: "rgba(28, 26, 21, 0.1)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${pct}%`,
                borderRadius: 999,
                background: "#20654a",
                transition: "width 90ms linear",
              }}
            />
          </div>
          <span
            style={{
              fontSize: "0.82rem",
              fontWeight: 700,
              color: "#57534a",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {pct}%
          </span>
        </div>
      </div>
    </div>
  );
}
