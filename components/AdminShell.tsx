"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { LogOut, Menu, ShieldCheck, X } from "lucide-react";
import AdminNav from "@/components/AdminNav";
import { ToastProvider } from "@/components/Toast";
import RouteWarmer from "@/components/RouteWarmer";

const ADMIN_ROUTES = [
  "/admin",
  "/admin/students",
  "/admin/batches",
  "/admin/courses",
  "/admin/search",
  "/admin/bulk",
  "/admin/audit-logs",
  "/admin/ai-assistant",
  "/admin/admins",
];

type Props = {
  userEmail: string;
  signOutAction: () => Promise<void>;
  children: React.ReactNode;
};

/**
 * Sidebar is permanently collapsed on desktop; hovering the rail expands
 * it (CSS-driven, see `.admin-shell[data-collapsed="true"] .admin-sidebar:hover`
 * in globals.css). No manual toggle, no localStorage state. On narrow viewports
 * the mobile drawer pattern still applies.
 */
export default function AdminShell({ userEmail, signOutAction, children }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  // Close mobile drawer on route change.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Lock body scroll while the mobile drawer is open + close on Escape.
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [mobileOpen]);

  return (
    <ToastProvider>
    <RouteWarmer routes={ADMIN_ROUTES} sessionKey="sx-admin-warmed" label="Preparing your workspace…" />
    <div
      className="admin-shell"
      data-collapsed="true"
      data-mobile-open={mobileOpen ? "true" : "false"}
    >
      <button
        type="button"
        className="sidebar-backdrop"
        aria-hidden={!mobileOpen}
        tabIndex={mobileOpen ? 0 : -1}
        onClick={() => setMobileOpen(false)}
      />

      <aside className="admin-sidebar" aria-label="Admin sidebar">
        <div className="sidebar-top">
          <div className="brand-cluster">
            <div className="brand-mark" aria-hidden="true">
              SS
            </div>
            <div className="brand-text">
              <strong>SkillSpark</strong>
              <span>Recorded videos</span>
            </div>
          </div>
          <button
            type="button"
            className="sidebar-mobile-close"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <AdminNav />

        <div className="admin-signout">
          <form action={signOutAction}>
            <button className="ghost-button" type="submit">
              <LogOut size={18} aria-hidden="true" />
              <span className="nav-label">Sign out</span>
            </button>
          </form>
        </div>
      </aside>

      <div className="admin-workspace">
        <header className="admin-topbar">
          <button
            type="button"
            className="sidebar-mobile-open"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            aria-expanded={mobileOpen}
          >
            <Menu size={18} aria-hidden="true" />
          </button>
          <div className="topbar-titles">
            <h2>Admin workspace</h2>
            <p>Manage students, access, courses, videos, and audit trails.</p>
          </div>
          <div className="admin-user" title={userEmail}>
            <ShieldCheck size={18} aria-hidden="true" />
            <span>{userEmail}</span>
          </div>
        </header>
        <main id="main-content" className="admin-content">
          {children}
        </main>
      </div>
    </div>
    </ToastProvider>
  );
}
