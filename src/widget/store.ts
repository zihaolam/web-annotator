import { batch, computed, signal } from "@preact/signals";
import type { Anchor, ThreadDTO, WidgetConfigDTO, WidgetSessionDTO } from "../shared/api";
import { ApiRequestError, createApi, type Api } from "./api";
import type { AnnotatorConfig } from "./config";
import { getGuestName, loadSession, safeGet, safeSet, saveSession, setGuestName } from "./lib/identity";
import { signInWithPopup } from "./lib/member-auth";
import { resolveAnchor } from "./lib/selector";
import { normalizePageUrl } from "./lib/url";

export type SelectionPhase = "compose" | "discard" | "posting" | "done" | "error";

export interface Selection {
  el: Element;
  anchor: Anchor;
  phase: SelectionPhase;
  error: string | null;
  /** Keep picking after this comment is posted (Cmd/Ctrl-click). */
  stayActive: boolean;
  /** Bumped to replay the shake animation on repeated cancel attempts. */
  shakeKey: number;
}

let api: Api;
let config: AnnotatorConfig;

export const picking = signal(false);
/** Element currently under the cursor (or chosen with arrow keys) while picking. */
export const hovered = signal<Element | null>(null);
/** Whether `hovered` was chosen with the keyboard; pointer moves then don't override it immediately. */
export const keyboardLocked = signal(false);
export const pointer = signal({ x: -1, y: -1 });
export const selection = signal<Selection | null>(null);
export const draft = signal("");

export const threads = signal<ThreadDTO[]>([]);
export const loadState = signal<"idle" | "loading" | "ready" | "error" | "signed-out">("idle");
export const loadError = signal<string | null>(null);
export const pageUrl = signal("");

export const activeThreadId = signal<string | null>(null);
/** Thread whose element is highlighted because its pin or list row is hovered. */
export const highlightThreadId = signal<string | null>(null);
export const listOpen = signal(false);
export const listFilter = signal<"open" | "resolved">("open");
export const pinsVisible = signal(safeGet("web-annotator:pins-hidden") !== "1");

// --- Auth

/** Per-project settings from the server (comment mode, sign-in URL). */
export const widgetConfig = signal<WidgetConfigDTO | null>(null);
export const session = signal<WidgetSessionDTO | null>(null);
/** Name typed by guests (guests mode only). */
export const guestName = signal(getGuestName());
export const signingIn = signal(false);
/** Short-lived message shown above the toolbar (sign-in errors, quota, …). */
export const notice = signal<{ text: string; tone: "info" | "error" } | null>(null);

export const commentMode = computed(() => widgetConfig.value?.commentMode ?? "guests");
export const identity = computed(() => session.value?.identity ?? null);
/** Guests can read without signing in; members/verified projects are private. */
export const canRead = computed(() => commentMode.value === "guests" || session.value !== null);
/** Guests only need to type a name in the composer; other modes must sign in first. */
export const needsGuestName = computed(() => commentMode.value === "guests" && !session.value);

/** Bumped on scroll/resize/layout changes so positioned UI re-measures. */
export const layoutTick = signal(0);
/** Thread id -> element it is anchored to (null = detached). */
export const resolved = signal<Map<string, Element | null>>(new Map());

/** Threads sorted oldest first; pin numbers are 1-based indices into this list. */
export const orderedThreads = computed(() => [...threads.value].sort((a, b) => a.createdAt - b.createdAt));
export const pinNumbers = computed(() => new Map(orderedThreads.value.map((t, i) => [t.id, i + 1])));
export const openCount = computed(() => threads.value.filter((t) => t.status === "open").length);
export const activeThread = computed(() => threads.value.find((t) => t.id === activeThreadId.value) ?? null);

export const isMine = (authorId: string) => identity.value?.id === authorId;

export const getConfig = () => config;

const message = (err: unknown) => (err instanceof ApiRequestError || err instanceof Error ? err.message : String(err));

let noticeTimer: ReturnType<typeof setTimeout> | undefined;
export const showNotice = (text: string, tone: "info" | "error" = "info") => {
  notice.value = { text, tone };
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (notice.value = null), 4500);
};

const setSession = (next: WidgetSessionDTO | null) => {
  session.value = next;
  saveSession(config.projectKey, next);
};

/** An expired/revoked token: drop it so the UI asks the visitor to sign in again. */
const handleAuthError = (err: unknown) => {
  if (err instanceof ApiRequestError && err.code === "auth_required" && session.value) {
    setSession(null);
    if (commentMode.value !== "guests") {
      threads.value = [];
      loadState.value = "signed-out";
    }
  }
};

/** Runs an API call, clearing a stale session on 401. */
const authed = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (err) {
    handleAuthError(err);
    throw err;
  }
};

export const init = async (c: AnnotatorConfig) => {
  config = c;
  api = createApi(c, () => session.value?.token ?? null);
  session.value = loadSession(c.projectKey);
  try {
    widgetConfig.value = await api.config();
  } catch (err) {
    loadState.value = "error";
    loadError.value = message(err);
    return;
  }
  // A session minted under a previous comment mode is useless now.
  const expected = { guests: "guest", members: "member", verified: "verified" }[commentMode.value];
  if (session.value && session.value.identity.type !== expected) setSession(null);
  if (commentMode.value === "verified" && c.userToken) await identify(c.userToken);
  await loadThreads();
};

// ---------------------------------------------------------------------------
// Sign-in

/** Verified mode: exchange a token signed by the host app's backend. */
export const identify = async (userToken: string) => {
  try {
    setSession(await api.verifiedSession(userToken));
  } catch (err) {
    showNotice(message(err), "error");
    return;
  }
  await loadThreads();
};

/**
 * Makes sure the visitor can comment. Guests get a session from their name;
 * members sign in through a popup; verified visitors must be identified by the
 * host app. Returns false (after showing why) when that isn't possible.
 */
export const ensureSession = async (): Promise<boolean> => {
  if (session.value) return true;
  const mode = commentMode.value;
  if (mode === "guests") {
    const name = guestName.value.trim();
    if (!name) return false;
    setGuestName(name);
    setSession(await api.guestSession(name));
    return true;
  }
  if (mode === "verified") {
    showNotice(`Sign in to ${widgetConfig.value?.projectName ?? "this site"} to comment`);
    return false;
  }
  return signInMember();
};

/** Members mode: Clerk sign-in popup. Must be called from a user gesture so the popup isn't blocked. */
export const signInMember = async (): Promise<boolean> => {
  const url = widgetConfig.value?.signInUrl;
  if (!url || signingIn.value) return false;
  signingIn.value = true;
  try {
    setSession(await signInWithPopup(url, config.projectKey));
    // The open comment list already shows who is signed in.
    if (!listOpen.value) showNotice(`Signed in as ${session.value!.identity.name}`);
    await loadThreads();
    return true;
  } catch (err) {
    showNotice(message(err), "error");
    return false;
  } finally {
    signingIn.value = false;
  }
};

export const signOut = async () => {
  batch(() => {
    setSession(null);
    stopPicking();
    activeThreadId.value = null;
  });
  await loadThreads();
};

// ---------------------------------------------------------------------------
// Loading & anchoring

let loadSeq = 0;
export const loadThreads = async () => {
  if (!api || !widgetConfig.value) return;
  const url = normalizePageUrl(config.urlMode);
  const seq = ++loadSeq;
  batch(() => {
    if (url !== pageUrl.value) {
      threads.value = [];
      activeThreadId.value = null;
    }
    pageUrl.value = url;
    loadState.value = canRead.value ? "loading" : "signed-out";
  });
  if (!canRead.value) {
    threads.value = [];
    return;
  }
  try {
    const list = await authed(() => api.listThreads(url));
    if (seq !== loadSeq) return;
    batch(() => {
      threads.value = list;
      loadState.value = "ready";
      loadError.value = null;
    });
    reresolve();
  } catch (err) {
    if (seq !== loadSeq || loadState.value === "signed-out") return;
    loadState.value = "error";
    loadError.value = message(err);
  }
};

export const reresolve = () => {
  const next = new Map<string, Element | null>();
  const prev = resolved.value;
  let changed = prev.size !== threads.value.length;
  for (const t of threads.value) {
    const cached = prev.get(t.id);
    const el = cached && cached.isConnected ? cached : resolveAnchor(t.anchor);
    next.set(t.id, el);
    if (el !== cached) changed = true;
  }
  if (changed) resolved.value = next;
};

const upsertThread = (thread: ThreadDTO) => {
  const exists = threads.value.some((t) => t.id === thread.id);
  threads.value = exists ? threads.value.map((t) => (t.id === thread.id ? thread : t)) : [...threads.value, thread];
};

// ---------------------------------------------------------------------------
// Picking

export const startPicking = async () => {
  if (!widgetConfig.value) {
    showNotice(loadError.value ?? "The annotator couldn't load", "error");
    return;
  }
  // Members/verified: sign in before entering comment mode.
  if (commentMode.value !== "guests" && !session.value && !(await ensureSession())) return;
  batch(() => {
    picking.value = true;
    activeThreadId.value = null;
    listOpen.value = false;
  });
};

export const stopPicking = () => {
  batch(() => {
    picking.value = false;
    hovered.value = null;
    keyboardLocked.value = false;
    selection.value = null;
    draft.value = "";
  });
};

export const togglePicking = () => (picking.value ? stopPicking() : void startPicking());

export const selectElement = (el: Element, anchor: Anchor, stayActive: boolean) => {
  batch(() => {
    selection.value = { el, anchor, phase: "compose", error: null, stayActive, shakeKey: 0 };
    hovered.value = el;
    draft.value = "";
  });
};

const patchSelection = (patch: Partial<Selection>) => {
  if (selection.value) selection.value = { ...selection.value, ...patch };
};

/** Escape / outside click while composing: confirm before throwing away a draft. */
export const requestCancelSelection = () => {
  const sel = selection.value;
  if (!sel) return;
  if (sel.phase === "discard" || sel.phase === "error" || sel.phase === "done" || !draft.value.trim()) {
    return cancelSelection();
  }
  if (sel.phase === "compose") patchSelection({ phase: "discard", shakeKey: sel.shakeKey + 1 });
};

export const cancelSelection = () => {
  batch(() => {
    selection.value = null;
    draft.value = "";
    keyboardLocked.value = false;
  });
};

export const keepComposing = () => patchSelection({ phase: "compose" });

let doneTimer: ReturnType<typeof setTimeout> | undefined;

export const submitSelection = async () => {
  const sel = selection.value;
  const body = draft.value.trim();
  if (!sel || !body || sel.phase === "posting") return;
  if (needsGuestName.value && !guestName.value.trim()) return;
  patchSelection({ phase: "posting", error: null });
  try {
    if (!(await ensureSession())) {
      patchSelection({ phase: "compose" });
      return;
    }
    const thread = await authed(() =>
      api.createThread({ pageUrl: pageUrl.value, pageTitle: document.title || null, anchor: sel.anchor, body }),
    );
    batch(() => {
      upsertThread(thread);
      resolved.value = new Map(resolved.value).set(thread.id, sel.el);
      draft.value = "";
      patchSelection({ phase: "done" });
    });
    clearTimeout(doneTimer);
    doneTimer = setTimeout(() => {
      if (selection.value?.phase !== "done") return;
      if (sel.stayActive) cancelSelection();
      else stopPicking();
    }, 1500);
  } catch (err) {
    patchSelection({ phase: "error", error: message(err) });
  }
};

export const retrySelection = () => {
  patchSelection({ phase: "compose", error: null });
  void submitSelection();
};

// ---------------------------------------------------------------------------
// Threads

export const openThread = (id: string | null) => {
  activeThreadId.value = id;
};

export const reply = async (threadId: string, body: string) => {
  if (!(await ensureSession())) throw new Error(needsGuestName.value ? "Add your name first" : "Sign in to reply");
  const comment = await authed(() => api.addComment(threadId, body));
  threads.value = threads.value.map((t) =>
    t.id === threadId ? { ...t, comments: [...t.comments, comment], updatedAt: comment.createdAt } : t,
  );
};

export const setStatus = async (threadId: string, status: "open" | "resolved") => {
  if (!(await ensureSession())) throw new Error(needsGuestName.value ? "Add your name first" : "Sign in first");
  upsertThread(await authed(() => api.setThreadStatus(threadId, status)));
};

export const removeThread = async (threadId: string) => {
  await authed(() => api.deleteThread(threadId));
  batch(() => {
    threads.value = threads.value.filter((t) => t.id !== threadId);
    if (activeThreadId.value === threadId) activeThreadId.value = null;
  });
};

export const editComment = async (threadId: string, commentId: string, body: string) => {
  const updated = await authed(() => api.editComment(threadId, commentId, body));
  threads.value = threads.value.map((t) =>
    t.id === threadId ? { ...t, comments: t.comments.map((c) => (c.id === commentId ? updated : c)) } : t,
  );
};

export const removeComment = async (threadId: string, commentId: string) => {
  await authed(() => api.deleteComment(threadId, commentId));
  const thread = threads.value.find((t) => t.id === threadId);
  if (thread && thread.comments.length <= 1) {
    batch(() => {
      threads.value = threads.value.filter((t) => t.id !== threadId);
      if (activeThreadId.value === threadId) activeThreadId.value = null;
    });
    return;
  }
  threads.value = threads.value.map((t) =>
    t.id === threadId ? { ...t, comments: t.comments.filter((c) => c.id !== commentId) } : t,
  );
};

export const togglePins = () => {
  pinsVisible.value = !pinsVisible.value;
  safeSet("web-annotator:pins-hidden", pinsVisible.value ? "0" : "1");
};

export const toggleList = () => {
  batch(() => {
    listOpen.value = !listOpen.value;
    if (listOpen.value) stopPicking();
  });
};

/** Scrolls a thread's element into view and opens it. */
export const focusThread = (id: string) => {
  const el = resolved.value.get(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  batch(() => {
    if (!pinsVisible.value) togglePins();
    activeThreadId.value = id;
  });
};
