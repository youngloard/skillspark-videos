"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Props = {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  basePath: string;
  /** Current search params to preserve when building page links. */
  searchParams: Record<string, string | undefined>;
};

export default function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  basePath,
  searchParams,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  const buildHref = (p: number) => {
    const params = new URLSearchParams();
    Object.entries(searchParams).forEach(([k, v]) => {
      if (v && v !== "" && k !== "page") params.set(k, v);
    });
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const visible = computeVisible(page, totalPages);
  const isFirst = page <= 1;
  const isLast = page >= totalPages;

  // Prefetch every reachable page target immediately (Next only auto-prefetches
  // links once they scroll into view — pagination sits at the bottom, so warm
  // them up front to make clicks feel instant).
  useEffect(() => {
    if (total === 0) return;
    const targets = new Set<number>([page - 1, page + 1, ...visible.filter((v): v is number => v !== "…")]);
    targets.forEach((p) => {
      if (p >= 1 && p <= totalPages && p !== page) router.prefetch(buildHref(p));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, totalPages, total]);

  if (total === 0) return null;

  // Soft-navigate inside a transition for instant pending feedback; keep the
  // real href so middle-click / modifier-click still opens a new tab.
  const go = (e: React.MouseEvent, href: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    startTransition(() => router.push(href, { scroll: false }));
  };

  return (
    <nav className="pagination" aria-label="Pagination" data-pending={pending ? "true" : undefined}>
      <span className="pagination-meta">
        Showing <strong>{start.toLocaleString()}</strong>–
        <strong>{end.toLocaleString()}</strong> of{" "}
        <strong>{total.toLocaleString()}</strong>
      </span>
      <div className="pagination-controls">
        {isFirst ? (
          <span className="pagination-btn" aria-disabled="true" data-disabled="true">
            <ChevronLeft size={14} aria-hidden="true" />
            Prev
          </span>
        ) : (
          <Link
            href={buildHref(page - 1)}
            className="pagination-btn"
            rel="prev"
            onClick={(e) => go(e, buildHref(page - 1))}
          >
            <ChevronLeft size={14} aria-hidden="true" />
            Prev
          </Link>
        )}

        {visible.map((p, i) =>
          p === "…" ? (
            <span key={`gap-${i}`} className="pagination-gap" aria-hidden="true">
              …
            </span>
          ) : (
            <Link
              key={p}
              href={buildHref(p)}
              className="pagination-btn pagination-num"
              data-active={p === page ? "true" : undefined}
              aria-current={p === page ? "page" : undefined}
              onClick={(e) => go(e, buildHref(p))}
            >
              {p}
            </Link>
          ),
        )}

        {isLast ? (
          <span className="pagination-btn" aria-disabled="true" data-disabled="true">
            Next
            <ChevronRight size={14} aria-hidden="true" />
          </span>
        ) : (
          <Link
            href={buildHref(page + 1)}
            className="pagination-btn"
            rel="next"
            onClick={(e) => go(e, buildHref(page + 1))}
          >
            Next
            <ChevronRight size={14} aria-hidden="true" />
          </Link>
        )}
      </div>
    </nav>
  );
}

function computeVisible(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  if (current > 3) out.push("…");
  for (
    let i = Math.max(2, current - 1);
    i <= Math.min(total - 1, current + 1);
    i++
  ) {
    out.push(i);
  }
  if (current < total - 2) out.push("…");
  out.push(total);
  return out;
}
