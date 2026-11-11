export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

type Init = Omit<RequestInit, "body"> & { body?: unknown };

async function request<T>(path: string, init: Init = {}): Promise<T> {
  const { body, headers, ...rest } = init;
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...rest,
    headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const isJson = (response.headers.get("content-type") || "").includes("application/json");
  const payload = isJson ? await response.clone().json() : null;
  if (!response.ok) {
    throw new ApiError(payload?.error || `HTTP ${response.status}`, response.status);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unbekannter Fehler";
}
