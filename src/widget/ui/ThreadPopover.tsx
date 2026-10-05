import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { CommentDTO, ThreadDTO } from "../../shared/api";
import { VIEWPORT_MARGIN, relativeTime } from "../lib/geometry";
import {
  activeThread,
  editComment,
  guestName,
  isMine,
  layoutTick,
  needsGuestName,
  openThread,
  pinNumbers,
  removeComment,
  removeThread,
  reply,
  setStatus,
} from "../store";
import { IconCheck, IconPencil, IconTrash, IconUndo, IconX } from "./icons";
import { PIN_SIZE, pinPoint } from "./Pins";
import { Avatar, AutoTextarea, Chip, IconButton, NameField, SubmitButton, cx } from "./primitives";

const WIDTH = 300;
const GAP = 10;

const useAsync = () => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
};

const CommentItem = ({ thread, comment }: { thread: ThreadDTO; comment: CommentDTO }) => {
  const mine = isMine(comment.author.id);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(comment.body);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { busy, error, run } = useAsync();

  const save = async () => {
    const body = value.trim();
    if (!body || body === comment.body) return setEditing(false);
    if (await run(() => editComment(thread.id, comment.id, body))) setEditing(false);
  };

  return (
    <li class="group/comment flex gap-2 px-3 py-2">
      <Avatar name={comment.author.name} url={comment.author.avatarUrl} />
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5">
          <span class="truncate font-semibold">{comment.author.name}</span>
          <span class="shrink-0 text-[11px] text-fg-muted" title={new Date(comment.createdAt).toLocaleString()}>
            {relativeTime(comment.createdAt)}
            {comment.updatedAt - comment.createdAt > 1000 && " · edited"}
          </span>
          {mine && !editing && !confirmDelete && (
            <span class="ml-auto flex opacity-0 transition-opacity group-hover/comment:opacity-100 focus-within:opacity-100">
              <IconButton label="Edit comment" class="size-5" onClick={() => setEditing(true)}>
                <IconPencil size={11} />
              </IconButton>
              <IconButton label="Delete comment" class="size-5" onClick={() => setConfirmDelete(true)}>
                <IconTrash size={11} />
              </IconButton>
            </span>
          )}
        </div>
        {editing ? (
          <div class="mt-1 flex items-end gap-2 rounded-lg border-[0.5px] border-line-strong px-2 py-1.5">
            <AutoTextarea
              value={value}
              onValue={setValue}
              onSubmit={() => void save()}
              onEscape={() => {
                setValue(comment.body);
                setEditing(false);
              }}
              placeholder="Edit comment"
              autoFocus
            />
            <SubmitButton disabled={busy || !value.trim()} onClick={() => void save()} label="Save" />
          </div>
        ) : (
          <p class="mt-0.5 break-words whitespace-pre-wrap text-fg">{comment.body}</p>
        )}
        {confirmDelete && (
          <div class="mt-1.5 flex items-center gap-1">
            <span class="mr-auto text-fg-muted">Delete this comment?</span>
            <Chip onClick={() => setConfirmDelete(false)}>No</Chip>
            <Chip tone="danger" disabled={busy} onClick={() => void run(() => removeComment(thread.id, comment.id))}>
              Delete
            </Chip>
          </div>
        )}
        {error && <p class="mt-1 text-[12px] text-danger">{error}</p>}
      </div>
    </li>
  );
};

/** Popover listing a thread's comments with a reply box, opened from a pin or the list. */
export const ThreadPopover = () => {
  void layoutTick.value;
  const thread = activeThread.value;
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [replyText, setReplyText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { busy, error, run, setError } = useAsync();
  const point = thread ? pinPoint(thread) : null;

  useLayoutEffect(() => {
    setReplyText("");
    setConfirmDelete(false);
    setError(null);
  }, [thread?.id]);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const h = node.offsetHeight;
    let left: number;
    let top: number;
    if (point) {
      left = point.x + PIN_SIZE + GAP;
      if (left + WIDTH > vw - VIEWPORT_MARGIN) left = point.x - WIDTH - GAP;
      top = point.y - PIN_SIZE;
    } else {
      // Detached thread: dock it on the right.
      left = vw - WIDTH - 16;
      top = 72;
    }
    left = Math.min(Math.max(left, VIEWPORT_MARGIN), vw - WIDTH - VIEWPORT_MARGIN);
    top = Math.min(Math.max(top, VIEWPORT_MARGIN), vh - h - VIEWPORT_MARGIN);
    node.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  });

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [thread?.id, thread?.comments.length]);

  if (!thread) return null;

  const number = pinNumbers.value.get(thread.id);
  const isAuthor = isMine(thread.author.id);
  const resolvedThread = thread.status === "resolved";
  const needsName = needsGuestName.value;

  const sendReply = async () => {
    const body = replyText.trim();
    if (!body || busy || (needsName && !guestName.value.trim())) return;
    if (await run(() => reply(thread.id, body))) setReplyText("");
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Comment thread ${number}`}
      class="pointer-events-auto fixed top-0 left-0 z-40 flex max-h-[min(480px,calc(100vh-16px))] animate-fade-in flex-col overflow-hidden rounded-[14px] bg-panel font-sans text-[13px] leading-[18px] font-medium text-fg antialiased shadow-panel"
      style={{ width: `${WIDTH}px` }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          openThread(null);
        }
      }}
    >
      <header class="flex items-center gap-1 border-b-[0.5px] border-line py-1.5 pr-1.5 pl-3">
        <span
          class={cx(
            "flex h-[18px] min-w-[18px] items-center justify-center rounded-full rounded-bl-none px-1 text-[10px] font-semibold text-white tabular-nums",
            resolvedThread ? "bg-fg-muted" : "bg-accent",
          )}
        >
          {number}
        </span>
        <span class="ml-1 truncate text-fg-muted">
          {resolvedThread ? "Resolved" : point ? `<${thread.anchor.tagName}>` : "Element not found"}
        </span>
        <span class="ml-auto flex items-center">
          <IconButton
            label={resolvedThread ? "Reopen" : "Resolve"}
            disabled={busy}
            onClick={() => void run(() => setStatus(thread.id, resolvedThread ? "open" : "resolved"))}
          >
            {resolvedThread ? <IconUndo size={13} /> : <IconCheck size={14} />}
          </IconButton>
          {isAuthor && (
            <IconButton label="Delete thread" onClick={() => setConfirmDelete(true)}>
              <IconTrash size={13} />
            </IconButton>
          )}
          <IconButton label="Close" onClick={() => openThread(null)}>
            <IconX size={13} />
          </IconButton>
        </span>
      </header>

      {confirmDelete && (
        <div class="flex items-center gap-1 border-b-[0.5px] border-line bg-danger-bg/40 px-3 py-1.5">
          <span class="mr-auto">Delete the whole thread?</span>
          <Chip onClick={() => setConfirmDelete(false)}>No</Chip>
          <Chip tone="danger" disabled={busy} onClick={() => void run(() => removeThread(thread.id))}>
            Delete
          </Chip>
        </div>
      )}

      <ul ref={listRef} class="min-h-0 flex-1 overflow-y-auto py-1 [scrollbar-width:thin]">
        {thread.comments.map((c) => (
          <CommentItem key={c.id} thread={thread} comment={c} />
        ))}
      </ul>

      <footer class="flex flex-col gap-1.5 border-t-[0.5px] border-line px-3 py-2">
        {needsName && <NameField value={guestName.value} onValue={(v) => (guestName.value = v)} />}
        <div class="flex items-end gap-2">
          <AutoTextarea
            value={replyText}
            onValue={setReplyText}
            onSubmit={() => void sendReply()}
            onEscape={() => openThread(null)}
            placeholder={resolvedThread ? "Reply (thread is resolved)" : "Reply"}
            autoFocus={!needsName}
          />
          <SubmitButton
            disabled={busy || !replyText.trim() || (needsName && !guestName.value.trim())}
            onClick={() => void sendReply()}
            label="Reply"
          />
        </div>
        {error && <p class="text-[12px] text-danger">{error}</p>}
      </footer>
    </div>
  );
};
