import type { WidgetSessionDTO } from "../../shared/api";

export const SESSION_MESSAGE = "web-annotator:session";
export const ERROR_MESSAGE = "web-annotator:error";

/**
 * Members mode: opens the annotator's sign-in page (Clerk) in a popup. Once the
 * visitor is signed in and confirmed as a workspace member, the page posts a
 * widget session back to this window and closes itself.
 */
export const signInWithPopup = (signInUrl: string, projectKey: string): Promise<WidgetSessionDTO> =>
  new Promise((resolve, reject) => {
    const url = new URL(signInUrl);
    url.searchParams.set("origin", location.origin);
    const w = 440;
    const h = 640;
    const left = Math.max(0, window.screenX + (window.outerWidth - w) / 2);
    const top = Math.max(0, window.screenY + (window.outerHeight - h) / 3);
    const popup = window.open(url, "web-annotator-signin", `popup,width=${w},height=${h},left=${left},top=${top}`);
    if (!popup) {
      reject(new Error("Allow pop-ups for this site to sign in"));
      return;
    }

    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      clearInterval(closedTimer);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== url.origin || e.source !== popup) return;
      const data = e.data as { type?: string; key?: string; session?: WidgetSessionDTO; error?: string } | null;
      if (data?.key !== projectKey) return;
      if (data.type === SESSION_MESSAGE && data.session) {
        cleanup();
        resolve(data.session);
      } else if (data.type === ERROR_MESSAGE) {
        cleanup();
        reject(new Error(data.error ?? "Sign-in failed"));
      }
    };
    const closedTimer = setInterval(() => {
      if (popup.closed) {
        cleanup();
        reject(new Error("Sign-in was cancelled"));
      }
    }, 500);
    window.addEventListener("message", onMessage);
  });
