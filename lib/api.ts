const BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://api.rms.genzfoods.pk/api";

export const TOKEN_KEY = "rms_token";
export const USER_KEY = "rms_user";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Clear the stored session and bounce to the login page. */
function handleUnauthorized() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
  } catch {
    // ignore storage errors
  }
  if (window.location.pathname !== "/") {
    window.location.href = "/";
  }
}

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...opts,
  });
  if (!res.ok) {
    // Session expired / missing token on a protected route — drop to login.
    if (res.status === 401 && path !== "/login") {
      handleUnauthorized();
    }
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  // No body to parse (e.g. 204 No Content from a delete, or an empty 200).
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get:    <T>(path: string)               => req<T>(path),
  post:   <T>(path: string, body: unknown) => req<T>(path, { method: "POST",   body: JSON.stringify(body) }),
  put:    <T>(path: string, body: unknown) => req<T>(path, { method: "PUT",    body: JSON.stringify(body) }),
  patch:  <T>(path: string, body: unknown) => req<T>(path, { method: "PATCH",  body: JSON.stringify(body) }),
  delete: <T>(path: string)               => req<T>(path, { method: "DELETE" }),
};
