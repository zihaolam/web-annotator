import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ApiError, WidgetSessionDTO } from "../shared/api";
import { createAuthClient, fetchPublicConfig, type AuthClient } from "./auth";
import { Button, Card, Field, Input } from "./ui";

/**
 * Popup opened by the widget in "workspace members" mode. Signs the visitor in
 * with Clerk, exchanges the Clerk session for a widget session (the server
 * checks workspace membership and that `origin` is allow-listed), then posts it
 * back to the opener — only to that origin — and closes.
 */

const params = new URLSearchParams(location.search);
const projectKey = params.get("key") ?? "";
const targetOrigin = params.get("origin") ?? "";

const SESSION_MESSAGE = "web-annotator:session";

type State =
  | { step: "loading" }
  | { step: "sign-in" }
  | { step: "exchanging" }
  | { step: "done"; name: string }
  | { step: "error"; message: string };

const exchange = async (auth: AuthClient): Promise<WidgetSessionDTO> => {
  const token = await auth.getToken();
  const res = await fetch(`/api/w/${encodeURIComponent(projectKey)}/session/member`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ origin: targetOrigin }),
  });
  const data = (await res.json()) as WidgetSessionDTO | ApiError;
  if (!res.ok) throw new Error((data as ApiError).error);
  return data as WidgetSessionDTO;
};

const ClerkSignIn = ({ auth }: { auth: AuthClient }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    auth.clerk!.mountSignIn(el, { forceRedirectUrl: location.href, signUpForceRedirectUrl: location.href });
    return () => auth.clerk!.unmountSignIn(el);
  }, []);
  return <div ref={ref} />;
};

const DevSignIn = ({ auth }: { auth: AuthClient }) => {
  const [name, setName] = useState("Dev User");
  const [userId, setUserId] = useState("user_dev");
  return (
    <Card class="w-full p-5">
      <form
        class="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          auth.devSignIn!({ userId, name, orgs: {} });
        }}
      >
        <p class="text-sm text-stone-500">Dev sign-in (Clerk not configured).</p>
        <Field label="Name">
          <Input value={name} onInput={(e) => setName(e.currentTarget.value)} />
        </Field>
        <Field label="User id">
          <Input value={userId} onInput={(e) => setUserId(e.currentTarget.value)} />
        </Field>
        <Button variant="primary" type="submit">
          Continue
        </Button>
      </form>
    </Card>
  );
};

const App = ({ auth }: { auth: AuthClient }) => {
  const [state, setState] = useState<State>({ step: "loading" });
  const [, force] = useState(0);
  useEffect(() => auth.onChange(() => force((n) => n + 1)), []);
  const signedIn = auth.isSignedIn();

  useEffect(() => {
    if (!projectKey || !targetOrigin || !window.opener) {
      setState({ step: "error", message: "Open this page from the comment widget on your site." });
      return;
    }
    if (!signedIn) {
      setState({ step: "sign-in" });
      return;
    }
    setState({ step: "exchanging" });
    exchange(auth).then(
      (session) => {
        (window.opener as Window).postMessage({ type: SESSION_MESSAGE, key: projectKey, session }, targetOrigin);
        setState({ step: "done", name: session.identity.name });
        setTimeout(() => window.close(), 600);
      },
      (err: Error) => setState({ step: "error", message: err.message }),
    );
  }, [signedIn]);

  return (
    <div class="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-5 p-6 text-center">
      <div>
        <h1 class="text-lg font-semibold">Sign in to comment</h1>
        {targetOrigin && <p class="mt-1 text-sm text-stone-500">on {targetOrigin.replace(/^https?:\/\//, "")}</p>}
      </div>
      {state.step === "sign-in" && (auth.kind === "clerk" ? <ClerkSignIn auth={auth} /> : <DevSignIn auth={auth} />)}
      {(state.step === "loading" || state.step === "exchanging") && <p class="text-sm text-stone-500">Checking access…</p>}
      {state.step === "done" && <p class="text-sm">Signed in as {state.name}. You can close this window.</p>}
      {state.step === "error" && (
        <Card class="grid w-full gap-3 p-4 text-sm">
          <p class="text-red-600 dark:text-red-400">{state.message}</p>
          {signedIn && (
            <Button onClick={() => void auth.signOut()}>Use a different account</Button>
          )}
        </Card>
      )}
    </div>
  );
};

const boot = async () => {
  const root = document.getElementById("app")!;
  try {
    const auth = await createAuthClient(await fetchPublicConfig());
    render(<App auth={auth} />, root);
  } catch (err) {
    root.textContent = err instanceof Error ? err.message : String(err);
  }
};

void boot();
