"use client";

/**
 * Chart.js wrappers for the admin home dashboard.
 *
 * One shared `Chart.register` call covers Line, Bar, Doughnut variants we use.
 * Each wrapper is a small, presentational component — the parent server page
 * computes the data and passes it in.
 *
 * Design language ("modern editorial dashboard"):
 *   · soft vertical gradient under the primary line, points only on hover
 *   · pill-rounded bars that fade along their length (solid → translucent)
 *   · segmented donuts: rounded arcs, gaps between segments, center total
 *   · dashed hairline grids, no axis borders, dark ink tooltips
 */

import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  DoughnutController,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type Plugin,
  type ScriptableContext,
} from "chart.js";
import { Bar, Doughnut, Line } from "react-chartjs-2";
import { useMemo } from "react";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Filler,
  Tooltip,
  Legend,
  LineController,
  BarController,
  DoughnutController,
);

// Curated categorical palette: balanced hues with shared saturation so
// multi-series visuals feel like one family. Chart.js can't read CSS vars,
// so these mirror the app's design tokens.
const COLOR_PRIMARY = "#1c1a15"; // espresso ink
const COLOR_GREEN = "#16a34a"; // primary series green — name kept for call-site stability
const COLOR_MUTED = "#8b8678";
const COLOR_GRID = "rgba(28, 26, 21, 0.06)";
const COLOR_GOOD = "#22c55e"; // semantic green (completion ≥ 75%)
const COLOR_WARN = "#f59e0b"; // semantic amber (40–74%)
const COLOR_BAD = "#ef4444"; // semantic red (< 40%)
const COLOR_BLUE = "#3b82f6";
const COLOR_VIOLET = "#8b5cf6";
const PALETTE = [
  "#2563eb", // blue
  "#16a34a", // green
  "#9333ea", // purple
  "#ea580c", // orange
  "#0891b2", // cyan
  "#db2777", // pink
  "#ca8a04", // gold
  "#475569", // slate
];

const FONT = {
  family: "'Schibsted Grotesk', Inter, ui-sans-serif, system-ui, sans-serif",
};

const TOOLTIP_BASE = {
  backgroundColor: COLOR_PRIMARY,
  titleColor: "#f6f4ec",
  bodyColor: "#f6f4ec",
  titleFont: { ...FONT, weight: 700, size: 12 },
  bodyFont: { ...FONT, size: 12 },
  borderColor: "rgba(246, 244, 236, 0.22)",
  borderWidth: 1,
  padding: 12,
  cornerRadius: 10,
  caretSize: 6,
  displayColors: false,
};

const LEGEND_LABELS = {
  color: COLOR_PRIMARY,
  font: { ...FONT, weight: 600, size: 11 },
  usePointStyle: true,
  pointStyle: "circle" as const,
  boxWidth: 6,
  boxHeight: 6,
  padding: 16,
};

/* ---------- color + gradient helpers ---------- */

function hexAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Soft vertical wash that fades to nothing at the baseline. */
function areaGradient(context: ScriptableContext<"line">, hex: string) {
  const { ctx, chartArea } = context.chart;
  if (!chartArea) return hexAlpha(hex, 0.12);
  const g = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
  g.addColorStop(0, hexAlpha(hex, 0));
  g.addColorStop(1, hexAlpha(hex, 0.22));
  return g;
}

/** Horizontal bars: solid at the label end, airy at the tip. */
function barGradientX(context: ScriptableContext<"bar">, hex: string) {
  const { ctx, chartArea } = context.chart;
  if (!chartArea) return hex;
  const g = ctx.createLinearGradient(chartArea.left, 0, chartArea.right, 0);
  g.addColorStop(0, hex);
  g.addColorStop(1, hexAlpha(hex, 0.55));
  return g;
}

/** Vertical bars: solid at the baseline, airy at the top. */
function barGradientY(context: ScriptableContext<"bar">, hex: string) {
  const { ctx, chartArea } = context.chart;
  if (!chartArea) return hex;
  const g = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
  g.addColorStop(0, hex);
  g.addColorStop(1, hexAlpha(hex, 0.55));
  return g;
}

/** Dashed hairline grid + clean axis (no border line, padded ticks). */
const AXIS_X = {
  ticks: { color: COLOR_MUTED, font: { ...FONT, size: 11 }, maxRotation: 0, autoSkip: true, padding: 6 },
  grid: { display: false },
  border: { display: false },
};

const AXIS_Y = {
  beginAtZero: true,
  ticks: { color: COLOR_MUTED, font: { ...FONT, size: 11 }, precision: 0, padding: 8 },
  grid: { color: COLOR_GRID },
  border: { display: false, dash: [4, 4] },
};

/** Draws a big total in the middle of a doughnut. */
function makeCenterText(value: () => string, label: string): Plugin<"doughnut"> {
  return {
    id: "sxCenterText",
    afterDraw(chart) {
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      const cx = (chartArea.left + chartArea.right) / 2;
      const cy = (chartArea.top + chartArea.bottom) / 2;
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `600 26px Oswald, ${FONT.family}`;
      ctx.fillStyle = COLOR_PRIMARY;
      ctx.fillText(value(), cx, cy - 9);
      ctx.font = `700 9px ${FONT.family}`;
      ctx.fillStyle = COLOR_MUTED;
      ctx.fillText(label.toUpperCase(), cx, cy + 13);
      ctx.restore();
    },
  };
}

function formatSeconds(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return "0m";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Truncate long labels (course or student names) for tight chart canvases. */
function ellipsize(s: string, max = 26): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// =====================================================================
// Daily activity — gradient area + dashed companion line
// =====================================================================

export function DailyActivityChart({
  data,
}: {
  data: { date: string; uniqueStudents: number; progressUpdates: number }[];
}) {
  const chartData = useMemo(
    () => ({
      labels: data.map((d) => {
        const dt = new Date(d.date);
        return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      }),
      datasets: [
        {
          label: "Active learners",
          data: data.map((d) => d.uniqueStudents),
          borderColor: COLOR_GREEN,
          backgroundColor: (ctx: ScriptableContext<"line">) => areaGradient(ctx, COLOR_GREEN),
          tension: 0.4,
          fill: true,
          borderWidth: 2.5,
          pointRadius: 0,
          pointHitRadius: 12,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: COLOR_GREEN,
          pointHoverBorderColor: "#ffffff",
          pointHoverBorderWidth: 2,
        },
        {
          label: "Progress events",
          data: data.map((d) => d.progressUpdates),
          borderColor: COLOR_VIOLET,
          tension: 0.4,
          fill: false,
          borderWidth: 2,
          borderDash: [5, 5],
          pointRadius: 0,
          pointHitRadius: 12,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: COLOR_VIOLET,
          pointHoverBorderColor: "#ffffff",
          pointHoverBorderWidth: 2,
        },
      ],
    }),
    [data],
  );

  return (
    <Line
      data={chartData}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "bottom", labels: LEGEND_LABELS },
          tooltip: TOOLTIP_BASE,
        },
        scales: { x: AXIS_X, y: AXIS_Y },
      }}
    />
  );
}

// =====================================================================
// Top items — horizontal gradient pills (watch seconds)
// =====================================================================

export function TopWatchBar({
  items,
  emptyLabel = "No data yet",
}: {
  items: { label: string; seconds: number; sublabel?: string }[];
  emptyLabel?: string;
}) {
  const chartData = useMemo(
    () => ({
      labels: items.map((i) => ellipsize(i.label, 32)),
      datasets: [
        {
          label: "Watch time",
          data: items.map((i) => Math.round(i.seconds / 60)),
          backgroundColor: (ctx: ScriptableContext<"bar">) =>
            barGradientX(ctx, PALETTE[ctx.dataIndex % PALETTE.length]!),
          hoverBackgroundColor: (ctx: ScriptableContext<"bar">) =>
            PALETTE[ctx.dataIndex % PALETTE.length]!,
          borderRadius: 999,
          borderSkipped: false,
          maxBarThickness: 16,
        },
      ],
    }),
    [items],
  );

  if (!items.length) {
    return <p className="chart-empty">{emptyLabel}</p>;
  }

  return (
    <Bar
      data={chartData}
      options={{
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...TOOLTIP_BASE,
            callbacks: {
              label: (ctx) => {
                const i = items[ctx.dataIndex];
                const t = i ? formatSeconds(i.seconds) : "";
                return i?.sublabel ? `${t} • ${i.sublabel}` : t;
              },
            },
          },
        },
        scales: {
          x: {
            ...AXIS_Y,
            ticks: { ...AXIS_Y.ticks, callback: (v) => `${v}m` },
          },
          y: {
            ticks: {
              color: COLOR_PRIMARY,
              font: { ...FONT, weight: 600, size: 12 },
              autoSkip: false,
            },
            grid: { display: false },
            border: { display: false },
          },
        },
      }}
    />
  );
}

// =====================================================================
// Course completion — semantic gradient pills (%)
// =====================================================================

export function CompletionBar({
  items,
  emptyLabel = "No completion data yet",
}: {
  items: { label: string; pct: number; completed: number; total: number }[];
  emptyLabel?: string;
}) {
  const chartData = useMemo(() => {
    const semantic = (pct: number) =>
      pct >= 75 ? COLOR_GOOD : pct >= 40 ? COLOR_WARN : COLOR_BAD;
    return {
      labels: items.map((i) => ellipsize(i.label, 32)),
      datasets: [
        {
          label: "Completion %",
          data: items.map((i) => i.pct),
          backgroundColor: (ctx: ScriptableContext<"bar">) =>
            barGradientX(ctx, semantic(items[ctx.dataIndex]?.pct ?? 0)),
          hoverBackgroundColor: (ctx: ScriptableContext<"bar">) =>
            semantic(items[ctx.dataIndex]?.pct ?? 0),
          borderRadius: 999,
          borderSkipped: false,
          maxBarThickness: 16,
        },
      ],
    };
  }, [items]);

  if (!items.length) {
    return <p className="chart-empty">{emptyLabel}</p>;
  }

  return (
    <Bar
      data={chartData}
      options={{
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...TOOLTIP_BASE,
            callbacks: {
              label: (ctx) => {
                const i = items[ctx.dataIndex];
                if (!i) return "";
                return `${i.pct}% complete • ${i.completed}/${i.total} lessons`;
              },
            },
          },
        },
        scales: {
          x: {
            ...AXIS_Y,
            max: 100,
            ticks: { ...AXIS_Y.ticks, callback: (v) => `${v}%` },
          },
          y: {
            ticks: { color: COLOR_PRIMARY, font: { ...FONT, weight: 600, size: 12 } },
            grid: { display: false },
            border: { display: false },
          },
        },
      }}
    />
  );
}

// =====================================================================
// Donut — student status breakdown (segmented, center total)
// =====================================================================

export function StudentStatusDonut({
  active,
  blocked,
  expired,
}: {
  active: number;
  blocked: number;
  expired: number;
}) {
  const total = active + blocked + expired;

  const chartData = useMemo(
    () => ({
      labels: ["Active", "Expired", "Blocked"],
      datasets: [
        {
          data: [active, expired, blocked],
          backgroundColor: [COLOR_GOOD, COLOR_WARN, COLOR_BAD],
          borderWidth: 0,
          borderRadius: 8,
          spacing: 3,
          hoverOffset: 8,
        },
      ],
    }),
    [active, blocked, expired],
  );

  const centerText = useMemo(
    () => makeCenterText(() => total.toLocaleString(), "students"),
    [total],
  );

  if (total === 0) return <p className="chart-empty">No students yet</p>;

  return (
    <Doughnut
      data={chartData}
      plugins={[centerText]}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        cutout: "70%",
        layout: { padding: 6 },
        plugins: {
          legend: { position: "bottom", labels: LEGEND_LABELS },
          tooltip: {
            ...TOOLTIP_BASE,
            callbacks: {
              label: (ctx) => {
                const v = Number(ctx.parsed);
                const pct = Math.round((v / total) * 100);
                return ` ${ctx.label}: ${v} (${pct}%)`;
              },
            },
          },
        },
      }}
    />
  );
}

// =====================================================================
// Catalog composition — segmented donut over content entities
// =====================================================================

export function CatalogDonut({
  segments,
}: {
  segments: { label: string; value: number }[];
}) {
  const filtered = segments.filter((s) => s.value > 0);
  const total = filtered.reduce((s, x) => s + x.value, 0);

  const chartData = useMemo(
    () => ({
      labels: filtered.map((s) => s.label),
      datasets: [
        {
          data: filtered.map((s) => s.value),
          backgroundColor: filtered.map((_, i) => PALETTE[i % PALETTE.length]),
          borderWidth: 0,
          borderRadius: 8,
          spacing: 3,
          hoverOffset: 8,
        },
      ],
    }),
    [filtered],
  );

  const centerText = useMemo(
    () => makeCenterText(() => total.toLocaleString(), "items"),
    [total],
  );

  if (total === 0) return <p className="chart-empty">No catalog content yet</p>;

  return (
    <Doughnut
      data={chartData}
      plugins={[centerText]}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        cutout: "70%",
        layout: { padding: 6 },
        plugins: {
          legend: {
            position: "bottom",
            labels: { ...LEGEND_LABELS, padding: 10 },
          },
          tooltip: {
            ...TOOLTIP_BASE,
            callbacks: {
              label: (ctx) => {
                const v = Number(ctx.parsed);
                const pct = Math.round((v / total) * 100);
                return ` ${ctx.label}: ${v.toLocaleString()} (${pct}%)`;
              },
            },
          },
        },
      }}
    />
  );
}

// =====================================================================
// Operational activity — audit events per day (gradient bars)
// =====================================================================

export function AuditActivityBar({
  data,
}: {
  data: { date: string; count: number }[];
}) {
  const hasAny = data.some((d) => d.count > 0);
  const chartData = useMemo(
    () => ({
      labels: data.map((d) => {
        const dt = new Date(d.date);
        return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      }),
      datasets: [
        {
          label: "Admin events",
          data: data.map((d) => d.count),
          backgroundColor: (ctx: ScriptableContext<"bar">) => barGradientY(ctx, COLOR_BLUE),
          hoverBackgroundColor: "#1d4ed8",
          borderRadius: 5,
          borderSkipped: false,
          maxBarThickness: 14,
        },
      ],
    }),
    [data],
  );

  if (!hasAny) return <p className="chart-empty">No admin activity in this window</p>;

  return (
    <Bar
      data={chartData}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { ...TOOLTIP_BASE, callbacks: { label: (ctx) => ` ${ctx.parsed.y} events` } },
        },
        scales: { x: AXIS_X, y: AXIS_Y },
      }}
    />
  );
}
