import type { WidgetSessionDTO } from "../../shared/api";

export const safeGet = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const safeSet = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode, sandboxed iframe) */
  }
};

export const safeRemove = (key: string) => {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
};

const sessionKey = (projectKey: string) => `web-annotator:session:${projectKey}`;
const GUEST_NAME_KEY = "web-annotator:guest-name";

/** The widget session for a project (one per browser), if it hasn't expired. */
export const loadSession = (projectKey: string): WidgetSessionDTO | null => {
  try {
    const parsed = JSON.parse(safeGet(sessionKey(projectKey)) ?? "null") as WidgetSessionDTO | null;
    if (!parsed?.token || parsed.expiresAt < Date.now() + 60_000) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const saveSession = (projectKey: string, session: WidgetSessionDTO | null) => {
  if (session) safeSet(sessionKey(projectKey), JSON.stringify(session));
  else safeRemove(sessionKey(projectKey));
};

export const getGuestName = (): string => safeGet(GUEST_NAME_KEY) ?? "";
export const setGuestName = (name: string) => safeSet(GUEST_NAME_KEY, name.trim());
