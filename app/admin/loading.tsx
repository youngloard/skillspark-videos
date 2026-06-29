export default function AdminLoading() {
  // Lightweight skeleton only. The 0→100% progress now shows once after login
  // (RouteWarmer in AdminShell), not on every page navigation — routes are
  // prefetched, so most navigations are instant from cache anyway.
  return (
    <div className="page-skeleton" aria-busy="true" aria-live="polite">
      <div className="skeleton skeleton-eyebrow" />
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-paragraph" />
      <div className="skeleton-grid">
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
      </div>
      <div className="skeleton skeleton-row" />
      <div className="skeleton skeleton-row" />
      <div className="skeleton skeleton-row" />
    </div>
  );
}
