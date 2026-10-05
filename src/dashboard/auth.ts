import { createDevToken, parseDevToken, type DevClaims } from "../shared/dev-token";

/**
 * Minimal surface of Clerk JS (v6) used here. Clerk is loaded from its own CDN
 * (the instance's Frontend API) so it isn't bundled into the dashboard.
 */
interface ClerkInstance {
  load(options?: Record<string, unknown>): Promise<void>;
  isSignedIn: boolean;
  user: {
    id: string;
    fullName: string | null;
    username: string | null;
    imageUrl: string;
    primaryEmailAddress: { emailAddress: string } | null;
  } | null;
  organization: { id: string; name: string } | null;
  session: { getToken(): Promise<string | null> } | null;
  addListener(cb: () => void): () => void;
  mountSignIn(el: HTMLElement, props?: Record<string, unknown>): void;
  mountUserButton(el: HTMLElement, props?: Record<string, unknown>): void;
  mountOrganizationSwitcher(el: HTMLElement, props?: Record<string, unknown>): void;
  unmountSignIn(el: HTMLElement): void;
  unmountUserButton(el: HTMLElement): void;
  unmountOrganizationSwitcher(el: HTMLElement): void;
  signOut(): Promise<void>;
}

declare global {
  interface Window {
    Clerk?: ClerkInstance;
    __internal_ClerkUICtor?: unknown;
  }
}

export interface AuthUser {
  name: string;
  email: string | null;
  avatarUrl: string | null;
}

export interface AuthClient {
  kind: "clerk" | "dev";
  isSignedIn(): boolean;
  user(): AuthUser | null;
  /** Active organization id, or null for the personal workspace. */
  orgId(): string | null;
  getToken(): Promise<string | null>;
  onChange(cb: () => void): () => void;
  signOut(): Promise<void>;
  /** Clerk only: the underlying instance for mounting its UI components. */
  clerk?: ClerkInstance;
  /** Dev only: sign in with made-up claims. */
  devSignIn?(claims: DevClaims): void;
}

export interface PublicConfig {
  clerkPublishableKey: string | null;
  devAuth: boolean;
}

export const fetchPublicConfig = async (): Promise<PublicConfig> => {
  const res = await fetch("/api/config");
  return (await res.json()) as PublicConfig;
};

const frontendApi = (publishableKey: string) =>
  atob(publishableKey.replace(/^pk_(test|live)_/, "")).replace(/\$$/, "");

const loadScript = (src: string, attrs: Record<string, string> = {}) =>
  new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.crossOrigin = "anonymous";
    for (const [k, v] of Object.entries(attrs)) script.setAttribute(k, v);
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });

const createClerkClient = async (publishableKey: string): Promise<AuthClient> => {
  const fapi = frontendApi(publishableKey);
  await loadScript(`https://${fapi}/npm/@clerk/ui@1/dist/ui.browser.js`);
  await loadScript(`https://${fapi}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, {
    "data-clerk-publishable-key": publishableKey,
  });
  const clerk = window.Clerk;
  if (!clerk) throw new Error("Clerk failed to initialise");
  await clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
  return {
    kind: "clerk",
    clerk,
    isSignedIn: () => clerk.isSignedIn,
    user: () =>
      clerk.user
        ? {
            name: clerk.user.fullName || clerk.user.username || clerk.user.primaryEmailAddress?.emailAddress || "You",
            email: clerk.user.primaryEmailAddress?.emailAddress ?? null,
            avatarUrl: clerk.user.imageUrl,
          }
        : null,
    orgId: () => clerk.organization?.id ?? null,
    getToken: async () => (await clerk.session?.getToken()) ?? null,
    onChange: (cb) => clerk.addListener(cb),
    signOut: () => clerk.signOut(),
  };
};

const DEV_KEY = "web-annotator:dev-session";

/** Local development without a Clerk account: identities are typed in and trusted on localhost. */
const createDevClient = (): AuthClient => {
  const listeners = new Set<() => void>();
  let token = localStorage.getItem(DEV_KEY);
  const claims = () => (token ? parseDevToken(token) : null);
  const set = (next: string | null) => {
    token = next;
    if (next) localStorage.setItem(DEV_KEY, next);
    else localStorage.removeItem(DEV_KEY);
    listeners.forEach((cb) => cb());
  };
  return {
    kind: "dev",
    isSignedIn: () => !!claims(),
    user: () => {
      const c = claims();
      return c ? { name: c.name, email: c.email ?? null, avatarUrl: c.avatarUrl ?? null } : null;
    },
    orgId: () => claims()?.orgId ?? null,
    getToken: async () => token,
    onChange: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    signOut: async () => set(null),
    devSignIn: (c) => set(createDevToken(c)),
  };
};

export const createAuthClient = async (config: PublicConfig): Promise<AuthClient> => {
  if (config.clerkPublishableKey) return createClerkClient(config.clerkPublishableKey);
  if (config.devAuth) return createDevClient();
  throw new Error("Sign-in isn't configured: set CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY on the Worker.");
};
