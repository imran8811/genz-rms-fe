"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { homeRouteFor, isKitchenUser, useAuth } from "@/lib/auth";

/**
 * `adminOnly` hides an entry from cashiers; `kitchen` is the opposite switch —
 * the *only* entries a kitchen login sees. Everything without it is off that
 * terminal's menu (and 403 on the API besides).
 */
const navGroups: {
  label: string;
  items: { href: string; label: string; adminOnly?: boolean; kitchen?: boolean; icon: React.ReactNode }[];
}[] = [
  {
    label: "Main",
    items: [
      {
        href: "/dashboard",
        label: "Dashboard",
        adminOnly: true,
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 flex-shrink-0">
            <rect x="3" y="3" width="7" height="7" rx="1"/>
            <rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="3" y="14" width="7" height="7" rx="1"/>
            <rect x="14" y="14" width="7" height="7" rx="1"/>
          </svg>
        ),
      },
      {
        href: "/billing",
        label: "Billing / POS",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 flex-shrink-0">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
            <rect x="9" y="3" width="6" height="4" rx="1"/>
            <path d="M9 12h6M9 16h4"/>
          </svg>
        ),
      },
      {
        href: "/orders",
        label: "Orders / Kitchen",
        kitchen: true,
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 flex-shrink-0">
            <path d="M6 2h12a1 1 0 011 1v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21V3a1 1 0 011-1z"/>
            <path d="M9 7h6M9 11h6M9 15h4"/>
          </svg>
        ),
      },
      {
        // Deliberately NOT `kitchen: true` — verifying an online order by phone
        // is the counter's job, and the API 403s a kitchen login on this feed.
        href: "/counter",
        label: "Orders / Counter",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 flex-shrink-0">
            <path d="M3 20h18M5 20v-7l7-4 7 4v7"/>
            <path d="M10 20v-4h4v4"/>
          </svg>
        ),
      },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        href: "/sales",
        label: "Sales",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 flex-shrink-0">
            <path d="M3 3v18h18"/>
            <path d="M7 16l4-4 4 4 4-4"/>
          </svg>
        ),
      },
      {
        href: "/purchasing",
        label: "Purchasing",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 flex-shrink-0">
            <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
            <line x1="3" y1="6" x2="21" y2="6"/>
            <path d="M16 10a4 4 0 01-8 0"/>
          </svg>
        ),
      },
      {
        href: "/expenses",
        label: "Expenses",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 flex-shrink-0">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
          </svg>
        ),
      },
      {
        href: "/inventory",
        label: "Inventory",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 flex-shrink-0">
            <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
            <line x1="12" y1="22.08" x2="12" y2="12"/>
          </svg>
        ),
      },
      {
        href: "/costing",
        label: "Costing",
        adminOnly: true,
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 flex-shrink-0">
            <circle cx="12" cy="12" r="9"/>
            <path d="M14.5 9a2.5 2.5 0 00-2.5-1.5c-1.4 0-2.5.9-2.5 2s1.1 2 2.5 2 2.5.9 2.5 2-1.1 2-2.5 2A2.5 2.5 0 019.5 15"/>
            <path d="M12 6v1.5M12 16.5V18"/>
          </svg>
        ),
      },
    ],
  },
  {
    label: "People",
    items: [
      {
        href: "/staff",
        label: "Staff",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 flex-shrink-0">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
          </svg>
        ),
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        href: "/settings",
        label: "Settings",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 flex-shrink-0">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
          </svg>
        ),
      },
    ],
  },
];

interface Props {
  /** Below `md` the sidebar is an off-canvas drawer; this is whether it's showing. */
  open?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ open = false, onClose }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "admin";
  const kitchenOnly = isKitchenUser(user);
  const home = user ? homeRouteFor(user) : "/billing";

  const handleLogout = async () => {
    await logout();
    router.replace("/");
  };

  return (
    <>
      {/* Drawer backdrop — mobile only; on md+ the sidebar is never "open". */}
      {open && (
        <div
          onClick={onClose}
          aria-hidden
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
        />
      )}

    <aside
      className={`w-56 flex-shrink-0 bg-slate-900 text-white flex flex-col h-full
        fixed inset-y-0 left-0 z-40 transition-transform duration-200 ease-out
        md:static md:z-auto md:translate-x-0 md:transition-none
        ${open ? "translate-x-0 shadow-2xl" : "-translate-x-full"}`}
    >
      {/* Logo */}
      <div className="flex items-center justify-between gap-2 px-4 py-5 border-b border-slate-800">
        <Link href={home} className="flex items-center gap-3 hover:opacity-90 transition-opacity">
          <div className="w-8 h-8 bg-brand-red rounded-lg flex items-center justify-center flex-shrink-0">
            <svg viewBox="0 0 24 24" fill="white" className="w-5 h-5">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
            </svg>
          </div>
          <div>
            <div className="text-sm font-bold leading-tight">Gen Z Foods</div>
            <div className="text-xs text-slate-400 leading-tight">RMS v1.0</div>
          </div>
        </Link>

        {/* Explicit way out of the drawer — tapping the backdrop works, but it
            isn't discoverable, and on mobile this is the whole screen. */}
        <button
          onClick={onClose}
          aria-label="Close menu"
          className="-mr-1 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white md:hidden"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {navGroups.map((group) => {
          const items = group.items.filter((item) =>
            kitchenOnly ? item.kitchen : isAdmin || !item.adminOnly,
          );
          if (items.length === 0) return null;
          return (
          <div key={group.label} className="mb-4">
            <div className="px-3 mb-1 text-xs font-semibold text-slate-500 uppercase tracking-wider">
              {group.label}
            </div>
            <ul className="space-y-0.5">
              {items.map((item) => {
                const isActive = pathname.startsWith(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                        isActive
                          ? "bg-brand-red text-white"
                          : "text-slate-300 hover:bg-slate-800 hover:text-white"
                      }`}
                    >
                      {item.icon}
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-slate-800 px-3 py-3">
        {user && (
          <div className="mb-2 flex items-center gap-2.5 px-2">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-white">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-white">{user.name}</div>
              <div className="truncate text-xs capitalize text-slate-400">{user.role}</div>
            </div>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700 hover:text-white"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Sign out
        </button>
      </div>
    </aside>
    </>
  );
}
