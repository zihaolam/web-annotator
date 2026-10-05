import { batch, computed, signal } from "@preact/signals";
import type { Anchor, ThreadDTO } from "../shared/api";
import { ApiRequestError, type Api } from "./api";
import type { AnnotatorConfig } from "./config";
import { getAuthor, safeGet, safeSet, setAuthorName } from "./lib/identity";
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
export const loadState = signal<"idle" | "loading" | "ready" | "error">("idle");
export const loadError = signal<string | null>(null);
export const pageUrl = signal("");

export const activeThreadId = signal<string | null>(null);
/** Thread whose element is highlighted because its pin or list row is hovered. */
export const highlightThreadId = signal<string | null>(null);
export const listOpen = signal(false);
export const listFilter = signal<"open" | "resolved">("open");
export const pinsVisible = signal(safeGet("web-annotator:pins-hidden") !== "1");
export const authorName = signal(getAuthor()?.name ?? "");

/** Bumped on scroll/resize/layout changes so positioned UI re-measures. */
export const layoutTick = signal(0);
/** Thread id -> element it is anchored to (null = detached). */
export const resolved = signal<Map<string, Element | null>>(new Map());

/** Threads sorted oldest first; pin numbers are 1-based indices into this list. */
export const orderedThreads = computed(() => [...threads.value].sort((a, b) => a.createdAt - b.createdAt));
export const pinNumbers = computed(() => new Map(orderedThreads.value.map((t, i) => [t.id, i + 1])));
export const openCount = computed(() => threads.value.filter((t) => t.status === "open").length);
export const activeThread = computed(() => threads.value.find((t) => t.id === activeThreadId.value) ?? null);

export const init = (a: Api, c: AnnotatorConfig) => {
  api = a;
  config = c;
};

export const getConfig = () => config;

const message = (err: unknown) => (err instanceof ApiRequestError || err instanceof Error ? err.message : String(err));

// ---------------------------------------------------------------------------
// Loading & anchoring

let loadSeq = 0;
export const loadThreads = async () => {
  const url = normalizePageUrl(config.urlMode);
  const seq = ++loadSeq;
  batch(() => {
    if (url !== pageUrl.value) {
      threads.value = [];
      activeThreadId.value = null;
    }
    pageUrl.value = url;
    loadState.value = "loading";
  });
  try {
    const list = await api.listThreads(url);
    if (seq !== loadSeq) return;
    batch(() => {
      threads.value = list;
      loadState.value = "ready";
      loadError.value = null;
    });
    reresolve();
  } catch (err) {
    if (seq !== loadSeq) return;
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

export const startPicking = () => {
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

export const togglePicking = () => (picking.value ? stopPicking() : startPicking());

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
  const name = authorName.value.trim();
  if (!name) return;
  setAuthorName(name);
  const author = getAuthor()!;
  patchSelection({ phase: "posting", error: null });
  try {
    const thread = await api.createThread({
      pageUrl: pageUrl.value,
      pageTitle: document.title || null,
      anchor: sel.anchor,
      body,
      author,
    });
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
  const name = authorName.value.trim();
  if (!name) throw new Error("Add your name first");
  setAuthorName(name);
  const comment = await api.addComment(threadId, { body, author: getAuthor()! });
  threads.value = threads.value.map((t) =>
    t.id === threadId ? { ...t, comments: [...t.comments, comment], updatedAt: comment.createdAt } : t,
  );
};

export const setStatus = async (threadId: string, status: "open" | "resolved") => {
  upsertThread(await api.setThreadStatus(threadId, status));
};

export const removeThread = async (threadId: string) => {
  await api.deleteThread(threadId);
  batch(() => {
    threads.value = threads.value.filter((t) => t.id !== threadId);
    if (activeThreadId.value === threadId) activeThreadId.value = null;
  });
};

export const editComment = async (threadId: string, commentId: string, body: string) => {
  const updated = await api.editComment(threadId, commentId, body);
  threads.value = threads.value.map((t) =>
    t.id === threadId ? { ...t, comments: t.comments.map((c) => (c.id === commentId ? updated : c)) } : t,
  );
};

export const removeComment = async (threadId: string, commentId: string) => {
  await api.deleteComment(threadId, commentId);
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
