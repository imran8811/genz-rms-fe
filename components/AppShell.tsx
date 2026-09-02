"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";

/**
 * The RMS chrome: the nav column plus whatever page is open.
 *
 * On `md` and up this is what it has always been — a fixed 224px sidebar beside
 * the page. Below `md` that column would eat well over half a phone screen, so
 * it becomes an off-canvas drawer and the only thing left in the flow is a slim
 * bar carrying the ☰ button.
 *
 * That bar lives here rather than in each page's own header on purpose: pages
 * are free to drop their headers at mobile widths (Sales does), and the way back
 * to the rest of the RMS must not disappear with them.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();

  // Following a link inside the drawer navigates *behind* it — close it, or the
  // page you asked for arrives hidden under the menu you asked it from.
  useEffect(() => setNavOpen(false), [pathname]);

  // A drawer with no visible way out is a trap on a phone with no back gesture.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile-only top bar: the drawer handle, and nothing else that would
            cost vertical room on a phone. */}
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-3 py-2 md:hidden">
          <button
            onClick={() => setNavOpen(true)}
            aria-label="Open menu"
            aria-expanded={navOpen}
            className="rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-100 active:bg-gray-200"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <span className="text-sm font-bold text-brand-ink">Gen Z Foods</span>
        </div>

        {/* Pages size themselves either with `h-full` or with `flex-1`; both
            need a parent that is exactly the space left *after* the mobile bar,
            or an `h-full` page resolves to the whole column and hangs its last
            rows off the bottom of the screen. `min-h-0` lets it shrink, which a
            flex item won't do by default however much its content overflows. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
