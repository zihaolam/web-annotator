import { describeElement } from "../lib/hit-test";
import { rectOf } from "../lib/geometry";
import {
  cancelSelection,
  draft,
  guestName,
  keepComposing,
  layoutTick,
  requestCancelSelection,
  retrySelection,
  needsGuestName,
  selection,
  submitSelection,
} from "../store";
import { Anchored, AutoTextarea, Chip, NameField, SubmitButton, TagBadge, cx } from "./primitives";
import { IconAlert, IconCheck, IconLoader } from "./icons";

/**
 * The selected element's label grows into a comment composer, mirroring
 * react-grab's prompt mode: tag badge on top, textarea below a hairline,
 * Enter submits, Esc asks "Discard?" when there is a draft.
 */
export const SelectionPanel = () => {
  void layoutTick.value;
  const sel = selection.value;
  if (!sel || !sel.el.isConnected) return null;
  const rect = rectOf(sel.el);
  const anchorX = rect.left + rect.width * sel.anchor.offsetX;
  const { tag, detail } = describeElement(sel.el);
  const needsName = needsGuestName.value;

  if (sel.phase === "done") {
    return (
      <Anchored target={rect} anchorX={anchorX}>
        <div role="status" aria-live="polite" class="flex animate-fade-in items-center gap-1.5 rounded-full bg-panel px-2 py-1.5">
          <IconCheck size={12} strokeWidth={3} />
          <span>Comment added</span>
        </div>
      </Anchored>
    );
  }

  if (sel.phase === "posting") {
    return (
      <Anchored target={rect} anchorX={anchorX}>
        <div class="flex items-center gap-1.5 rounded-full bg-panel px-2 py-1.5">
          <IconLoader size={12} class="text-fg-muted" />
          <span class="shimmer-text">Posting…</span>
        </div>
      </Anchored>
    );
  }

  if (sel.phase === "error") {
    return (
      <Anchored target={rect} anchorX={anchorX} interactive>
        <div role="alert" class="flex w-[260px] flex-col gap-2 rounded-[14px] bg-panel px-2 py-1.5">
          <div class="flex items-start gap-1.5 text-danger">
            <IconAlert size={13} class="mt-px shrink-0" />
            <span class="line-clamp-5">{sel.error}</span>
          </div>
          <div class="flex justify-end gap-1">
            <Chip onClick={cancelSelection}>
              Ok <span class="text-fg-muted">Esc</span>
            </Chip>
            <Chip tone="primary" onClick={retrySelection}>
              Retry ↵
            </Chip>
          </div>
        </div>
      </Anchored>
    );
  }

  const discarding = sel.phase === "discard";
  const canSubmit = draft.value.trim().length > 0 && (!needsName || guestName.value.trim().length > 0);

  return (
    <Anchored target={rect} anchorX={anchorX} interactive>
      <div
        key={sel.shakeKey}
        class={cx("flex w-[280px] flex-col rounded-[14px] bg-panel", sel.shakeKey > 0 && "animate-shake")}
      >
        <div class="flex items-center gap-2 px-2 pt-1.5 pb-1.5">
          <TagBadge tag={tag} detail={detail} />
        </div>
        <div class="flex flex-col gap-1.5 border-t-[0.5px] border-line px-2 py-1.5">
          {discarding ? (
            <div class="flex items-center justify-between gap-2">
              <span>Discard comment?</span>
              <div class="flex gap-1">
                <Chip onClick={keepComposing} autoFocus>
                  No
                </Chip>
                <Chip tone="danger" onClick={cancelSelection}>
                  Yes ↵
                </Chip>
              </div>
            </div>
          ) : (
            <>
              {needsName && <NameField value={guestName.value} onValue={(v) => (guestName.value = v)} />}
              <div class="flex items-end gap-2">
                <AutoTextarea
                  value={draft.value}
                  onValue={(v) => (draft.value = v)}
                  onSubmit={() => void submitSelection()}
                  onEscape={requestCancelSelection}
                  placeholder="Add a comment"
                  autoFocus={!needsName}
                  maxHeight={95}
                />
                <SubmitButton disabled={!canSubmit} onClick={() => void submitSelection()} label="Comment" />
              </div>
            </>
          )}
        </div>
      </div>
    </Anchored>
  );
};
