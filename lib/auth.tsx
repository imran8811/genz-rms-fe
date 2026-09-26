"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, TOKEN_KEY, USER_KEY } from "@/lib/api";

/**
 * `kitchen` is the terminal in the back: it works from the orders board, and
 * may additionally *read* the complaints register. The gate that matters is the
 * backend's (RestrictKitchenUser 403s every other endpoint); the checks here
 * just keep the UI from offering doors that would only slam.
 */
export type UserRole = "admin" | "user" | "kitchen";

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
}

interface LoginResponse {
  token: string;
  user: AuthUser;
}

interface AuthContextValue {
  user: AuthUser | null;
  /** True until the stored session has been read from localStorage. */
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore the session on first mount.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(USER_KEY);
      const token = window.localStorage.getItem(TOKEN_KEY);
      if (raw && token) setUser(JSON.parse(raw) as AuthUser);
    } catch {
      // ignore parse / storage errors
    }
    setLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<LoginResponse>("/login", { email, password });
    window.localStorage.setItem(TOKEN_KEY, res.token);
    window.localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/logout", {});
    } catch {
      // even if the server call fails, drop the local session
    }
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

/** Where a kitchen login lands, and the only screen it can act on. */
export const KITCHEN_HOME = "/orders";

/**
 * Every route a kitchen login may open. The board is its home; the complaints
 * register is there to be **read** — the board's ⚠ tab only covers today, and
 * "has this dish come back before?" is a kitchen question that needs looking
 * further back than that. It cannot act on what it finds there: the API allows
 * the kitchen the register and nothing else on it (see `RestrictKitchenUser`),
 * so resolving, reopening and deleting are hidden for it in the UI.
 *
 * `/billing` is on the list for the **menu**, not the till: what a dish is
 * called, what is in it and what it costs is the kitchen's own reference, and
 * it was having to ask the front desk. It gets the categories and items and
 * nothing else — the bill panel is not rendered and the cards don't open a
 * picker, so there is no cart to place. That is a UI convenience on top of the
 * real gate: `RestrictKitchenUser` does not allow `orders`, so a kitchen login
 * cannot create an order however it reaches the endpoint. The menu itself needs
 * no backend permission at all — it is read straight from the genz-admin feed.
 */
const KITCHEN_ROUTES = [KITCHEN_HOME, "/complaints", "/billing"];

/** Is this the back-of-house login, restricted to the orders board? */
export function isKitchenUser(user: Pick<AuthUser, "role"> | null | undefined): boolean {
  return user?.role === "kitchen";
}

/**
 * The default landing route for a role: admins → dashboard, the kitchen → its
 * board, everyone else → billing.
 */
export function homeRouteFor(user: Pick<AuthUser, "role">): string {
  if (user.role === "admin") return "/dashboard";
  if (user.role === "kitchen") return KITCHEN_HOME;
  return "/billing";
}

/** Whether `user` is allowed to open `pathname` at all. */
export function canOpen(user: Pick<AuthUser, "role">, pathname: string): boolean {
  if (!isKitchenUser(user)) return true;
  return KITCHEN_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

/** Full-screen placeholder shown while we resolve auth state or redirect. */
function AuthFallback() {
  return (
    <div className="flex h-screen items-center justify-center text-gray-400">
      Loading…
    </div>
  );
}

/**
 * Gate any logged-in user. Redirects to the login page when unauthenticated,
 * and bounces a kitchen login typing its way anywhere but the board back to it.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const blocked = Boolean(user) && !canOpen(user!, pathname);

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/");
    else if (blocked) router.replace(homeRouteFor(user));
  }, [loading, user, blocked, router]);

  if (loading || !user || blocked) return <AuthFallback />;
  return <>{children}</>;
}

/** Gate admin-only routes. Everyone else lands on their own home route. */
export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/");
    else if (user.role !== "admin") router.replace(homeRouteFor(user));
  }, [loading, user, router]);

  if (loading || !user || user.role !== "admin") return <AuthFallback />;
  return <>{children}</>;
}
