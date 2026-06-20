import { Activity } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authorization";
import Dropdown from "@/components/Dropdown";
import Pagination from "@/components/Pagination";
import { getAuditFacets } from "@/lib/catalog-cache";

const PAGE_SIZE = 10;

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<{
    actorEmail?: string;
    action?: string;
    entityType?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const where: any = {};
  if (sp.actorEmail) where.actorEmail = { contains: sp.actorEmail.toLowerCase() };
  if (sp.action) where.action = sp.action;
  if (sp.entityType) where.entityType = sp.entityType;
  if (sp.from || sp.to) {
    where.createdAt = {};
    if (sp.from) where.createdAt.gte = new Date(sp.from);
    if (sp.to) where.createdAt.lte = new Date(sp.to);
  }

  const [total, logs, facets] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    getAuditFacets(),
  ]);
  const { actions, entities } = facets;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const actionOptions = [
    { value: "", label: "Any action" },
    ...actions.map((a) => ({ value: a.action, label: a.action })),
  ];
  const entityOptions = [
    { value: "", label: "Any entity" },
    ...entities
      .filter((e): e is { entityType: string } => Boolean(e.entityType))
      .map((e) => ({ value: e.entityType, label: e.entityType })),
  ];

  return (
    <div className="wide-canvas audit-page">
      <header className="students-hero">
        <div className="students-hero-text">
          <span className="eyebrow">
            <Activity size={14} aria-hidden="true" />
            Trail
          </span>
          <h1>Audit logs</h1>
          <p>
            Every admin write and authentication event. Filter by actor, action, entity, or
            timeframe. Newest events first.
          </p>
        </div>
        <div className="students-hero-stats">
          <article className="kpi" data-tone="total">
            <span className="kpi-label">Matching</span>
            <span className="kpi-value">{total.toLocaleString()}</span>
          </article>
        </div>
      </header>

      <form className="filter-bar" method="get" aria-label="Filter audit logs">
        <input
          name="actorEmail"
          placeholder="Actor email"
          defaultValue={sp.actorEmail ?? ""}
          aria-label="Filter by actor email"
        />
        <Dropdown
          name="action"
          options={actionOptions}
          defaultValue={sp.action ?? ""}
          placeholder="Any action"
          ariaLabel="Filter by action"
          minWidth={200}
        />
        <Dropdown
          name="entityType"
          options={entityOptions}
          defaultValue={sp.entityType ?? ""}
          placeholder="Any entity"
          ariaLabel="Filter by entity"
          minWidth={180}
        />
        <span className="dropdown-label-pair">
          <span className="dropdown-label">From</span>
          <input name="from" type="date" defaultValue={sp.from ?? ""} />
        </span>
        <span className="dropdown-label-pair">
          <span className="dropdown-label">To</span>
          <input name="to" type="date" defaultValue={sp.to ?? ""} />
        </span>
        <button type="submit" className="filter-submit">
          Apply filters
        </button>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Entity</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr>
                <td colSpan={5} className="table-empty">
                  No events match the current filters.
                </td>
              </tr>
            )}
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="cell-mono">
                  {l.createdAt.toISOString().replace("T", " ").slice(0, 19)}
                </td>
                <td>
                  <span className="actor-line">
                    <strong>{l.actorEmail ?? "—"}</strong>
                    <span className="actor-type">{l.actorType}</span>
                  </span>
                </td>
                <td>
                  <code>{l.action}</code>
                </td>
                <td className="cell-muted">
                  {l.entityType ?? "—"}
                  {l.entityId ? (
                    <span className="entity-id"> #{l.entityId.slice(0, 8)}</span>
                  ) : null}
                </td>
                <td className="cell-mono">{l.ipAddress ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={PAGE_SIZE}
        basePath="/admin/audit-logs"
        searchParams={sp}
      />
    </div>
  );
}
