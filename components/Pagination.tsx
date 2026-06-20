import Link from "next/link";
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
  if (total === 0) return null;

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

  return (
    <nav className="pagination" aria-label="Pagination">
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
            href={buildHref(Math.max(1, page - 1))}
            className="pagination-btn"
            rel="prev"
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
            href={buildHref(Math.min(totalPages, page + 1))}
            className="pagination-btn"
            rel="next"
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
