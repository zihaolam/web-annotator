import type {
  ApiError,
  CommentDTO,
  CreateProjectInput,
  ProjectDTO,
  ThreadDTO,
  UpdateProjectInput,
  WorkspaceDTO,
} from "../shared/api";
import type { AuthClient } from "./auth";

export class DashboardApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export const createDashboardApi = (auth: AuthClient) => {
  const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const token = await auth.getToken();
    const res = await fetch(`/api/dashboard${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => null)) as T | ApiError | null;
    if (!res.ok) {
      const err = data as ApiError | null;
      throw new DashboardApiError(res.status, err?.error ?? `Request failed (${res.status})`, err?.code);
    }
    return data as T;
  };

  return {
    workspace: () => request<WorkspaceDTO>("GET", "/workspace"),
    projects: () => request<ProjectDTO[]>("GET", "/projects"),
    project: (id: string) => request<ProjectDTO>("GET", `/projects/${id}`),
    createProject: (input: CreateProjectInput) => request<ProjectDTO>("POST", "/projects", input),
    updateProject: (id: string, input: UpdateProjectInput) => request<ProjectDTO>("PATCH", `/projects/${id}`, input),
    rotate: (id: string, key: "publicKey" | "identitySecret") => request<ProjectDTO>("POST", `/projects/${id}/rotate`, { key }),
    deleteProject: (id: string) => request<void>("DELETE", `/projects/${id}`),
    threads: (id: string, status: "open" | "resolved") => request<ThreadDTO[]>("GET", `/projects/${id}/threads?status=${status}`),
    setStatus: (id: string, threadId: string, status: "open" | "resolved") =>
      request<ThreadDTO>("PATCH", `/projects/${id}/threads/${threadId}`, { status }),
    reply: (id: string, threadId: string, body: string) =>
      request<CommentDTO>("POST", `/projects/${id}/threads/${threadId}/comments`, { body }),
    deleteThread: (id: string, threadId: string) => request<void>("DELETE", `/projects/${id}/threads/${threadId}`),
  };
};

export type DashboardApi = ReturnType<typeof createDashboardApi>;
