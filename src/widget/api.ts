import type {
  ApiError,
  CommentDTO,
  CreateCommentInput,
  CreateThreadInput,
  ThreadDTO,
  ThreadStatus,
} from "../shared/api";
import type { AnnotatorConfig } from "./config";
import { getAuthorId } from "./lib/identity";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const createApi = (config: AnnotatorConfig) => {
  const base = `${config.apiBase}/api/projects/${encodeURIComponent(config.projectId)}`;

  const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    let res: Response;
    try {
      res = await fetch(base + path, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          "x-annotator-author-id": getAuthorId(),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiRequestError(0, "Couldn't reach the annotation server");
    }
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => null)) as T | ApiError | null;
    if (!res.ok) {
      throw new ApiRequestError(res.status, (data as ApiError | null)?.error ?? `Request failed (${res.status})`);
    }
    return data as T;
  };

  return {
    listThreads: (pageUrl: string) => request<ThreadDTO[]>("GET", `/threads?url=${encodeURIComponent(pageUrl)}`),
    createThread: (input: CreateThreadInput) => request<ThreadDTO>("POST", "/threads", input),
    setThreadStatus: (threadId: string, status: ThreadStatus) =>
      request<ThreadDTO>("PATCH", `/threads/${threadId}`, { status }),
    deleteThread: (threadId: string) => request<void>("DELETE", `/threads/${threadId}`),
    addComment: (threadId: string, input: CreateCommentInput) =>
      request<CommentDTO>("POST", `/threads/${threadId}/comments`, input),
    editComment: (threadId: string, commentId: string, body: string) =>
      request<CommentDTO>("PATCH", `/threads/${threadId}/comments/${commentId}`, { body }),
    deleteComment: (threadId: string, commentId: string) =>
      request<void>("DELETE", `/threads/${threadId}/comments/${commentId}`),
  };
};

export type Api = ReturnType<typeof createApi>;
