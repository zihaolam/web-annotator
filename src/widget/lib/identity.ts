import type { Author } from "../../shared/api";

const ID_KEY = "web-annotator:author-id";
const NAME_KEY = "web-annotator:author-name";

const safeGet = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeSet = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode, sandboxed iframe) */
  }
};

let memoryId: string | null = null;

/** Anonymous, per-browser identity. Names are self-declared; there is no login. */
export const getAuthorId = (): string => {
  const stored = safeGet(ID_KEY) ?? memoryId;
  if (stored) return stored;
  memoryId = crypto.randomUUID();
  safeSet(ID_KEY, memoryId);
  return memoryId;
};

export const getAuthorName = (): string | null => safeGet(NAME_KEY);

export const setAuthorName = (name: string) => safeSet(NAME_KEY, name.trim());

export const getAuthor = (): Author | null => {
  const name = getAuthorName();
  return name ? { id: getAuthorId(), name } : null;
};

export { safeGet, safeSet };
