import type {
  ApiError,
  CommentDTO,
  CreateThreadInput,
  ThreadDTO,
  ThreadStatus,
  WidgetConfigDTO,
  WidgetSessionDTO,
} from "../shared/api";
import type { AnnotatorConfig } from "./config";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export const createApi = (config: AnnotatorConfig, getToken: () => string | null) => {
  const base = `${config.apiBase}/api/w/${encodeURIComponent(config.projectKey)}`;

  const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const token = getToken();
    let res: Response;
    try {
      res = await fetch(base + path, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiRequestError(0, "Couldn't reach the annotation server");
    }
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => null)) as T | ApiError | null;
    if (!res.ok) {
      const err = data as ApiError | null;
      throw new ApiRequestError(res.status, err?.error ?? `Request failed (${res.status})`, err?.code);
    }
    return data as T;
  };

  return {
    config: () => request<WidgetConfigDTO>("GET", "/config"),
    guestSession: (name: string, token?: string) =>
      request<WidgetSessionDTO>("POST", "/session/guest", { name, ...(token ? { token } : {}) }),
    verifiedSession: (token: string) => request<WidgetSessionDTO>("POST", "/session/verified", { token }),
    listThreads: (pageUrl: string) => request<ThreadDTO[]>("GET", `/threads?url=${encodeURIComponent(pageUrl)}`),
    createThread: (input: CreateThreadInput) => request<ThreadDTO>("POST", "/threads", input),
    setThreadStatus: (threadId: string, status: ThreadStatus) =>
      request<ThreadDTO>("PATCH", `/threads/${threadId}`, { status }),
    deleteThread: (threadId: string) => request<void>("DELETE", `/threads/${threadId}`),
    addComment: (threadId: string, body: string) => request<CommentDTO>("POST", `/threads/${threadId}/comments`, { body }),
    editComment: (threadId: string, commentId: string, body: string) =>
      request<CommentDTO>("PATCH", `/threads/${threadId}/comments/${commentId}`, { body }),
    deleteComment: (threadId: string, commentId: string) =>
      request<void>("DELETE", `/threads/${threadId}/comments/${commentId}`),
  };
};

export type Api = ReturnType<typeof createApi>;
