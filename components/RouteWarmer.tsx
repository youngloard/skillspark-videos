"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ProgressLoader from "@/components/ProgressLoader";

/**
 * Warms the Next.js Router Cache for a set of routes right after login, so
 * subsequent navigations are instant (served from cache) — while data stays
 * correct because each mutation's `revalidatePath` invalidates the cache.
 *
 * Shows a single 0→100% progress overlay ONCE per browser session (gated by
 * sessionStorage), then never again — so the progress appears post-login, not
 * on every page. Prefetch itself always runs (cheap, fire-and-forget).
 */
export default function RouteWarmer({
  routes,
  sessionKey,
  label = "Preparing your workspace…",
}: {
  routes: string[];
  sessionKey: string;
  label?: string;
}) {
  const router = useRouter();
  const [pct, setPct] = useState(0);
  const [show, setShow] = useState(false);
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    // Always warm the cache.
    for (const r of routes) router.prefetch(r);

    // Show the progress overlay only the first time this session.
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(sessionKey)) return;
    sessionStorage.setItem(sessionKey, "1");
    setShow(true);

    const DURATION = 1300;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      setPct(Math.round((1 - Math.pow(1 - t, 2)) * 100));
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        window.setTimeout(() => setShow(false), 220);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [router, routes, sessionKey]);

  if (!show) return null;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "#f3f1ea",
        display: "grid",
        placeItems: "center",
      }}
    >
      <ProgressLoader label={label} value={pct} />
    </div>
  );
}
