export const API_BASE =
  process.env.NEXT_PUBLIC_OPENFROST_API_URL ?? 'http://127.0.0.1:8787';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) {
        message = body.error;
      }
    } catch {
      // Non-JSON error body; keep the default message.
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export interface SessionInfo {
  authenticated: boolean;
  ownerCreated: boolean;
  onboardingCompletedAt: string | null;
  csrfToken?: string;
}

export interface Mutation {
  method: 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  csrfToken: string | null;
}

export async function mutate<T>(mutation: Mutation): Promise<T> {
  return request<T>(mutation.path, {
    method: mutation.method,
    headers: mutation.csrfToken ? { 'x-csrf-token': mutation.csrfToken } : {},
    body: mutation.body === undefined ? undefined : JSON.stringify(mutation.body),
  });
}

export async function getJson<T>(path: string): Promise<T> {
  return request<T>(path);
}
