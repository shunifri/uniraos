/**
 * Shared API mocking utilities for frontend tests.
 * Provides helpers to mock the `api` object (get/post/put/del) and
 * to mock `globalThis.fetch` directly for lower-level tests.
 */

import { vi } from "vitest";

export type MockResponse<T = unknown> =
  | { ok: true; data: T; status?: number }
  | { ok: false; error: string; status: number };

/** Reset all api mock functions. Call in `beforeEach`. */
export function resetApiMocks() {
  mockApi.get.mockReset();
  mockApi.post.mockReset();
  mockApi.put.mockReset();
  mockApi.del.mockReset();
}

/** Pre-configured mock api object compatible with `web/src/api/index.ts`. */
export const mockApi = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
};

/**
 * Helper: queue a successful response for a specific api method.
 * Example: `queueApiResponse(mockApi.get, '/api/skills', { items: [] })`
 */
export function queueApiResponse<T>(
  method: typeof mockApi.get,
  expectedUrl: string,
  data: T,
) {
  method.mockImplementation(async (url: string) => {
    if (url === expectedUrl) return data;
    throw new Error(`Unexpected URL: ${url}`);
  });
}

/**
 * Helper: queue an error response for a specific api method.
 */
export function queueApiError(
  method: typeof mockApi.get,
  expectedUrl: string,
  errorMessage: string,
  status = 500,
) {
  method.mockImplementation(async (url: string) => {
    if (url === expectedUrl) {
      const err: any = new Error(errorMessage);
      err.status = status;
      throw err;
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
}

// ---------------------------------------------------------------------------
// Low-level fetch mocking
// ---------------------------------------------------------------------------

let originalFetch: typeof globalThis.fetch;

/** Replace global fetch with a mock for the duration of a test suite. */
export function installFetchMock(mockFn = vi.fn()) {
  originalFetch = globalThis.fetch;
  globalThis.fetch = mockFn as any;
  return mockFn;
}

/** Restore the original global fetch. */
export function uninstallFetchMock() {
  globalThis.fetch = originalFetch;
}

/** Build a Response-like object for fetch mocking. */
export function makeJsonResponse<T>(
  data: T,
  status = 200,
  statusText = "OK",
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => data,
    headers: new Headers({ "content-type": "application/json" }),
    body: null,
    bodyUsed: false,
    clone: () => makeJsonResponse(data, status, statusText),
    text: async () => JSON.stringify(data),
    blob: async () => new Blob([JSON.stringify(data)]),
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(data)).buffer,
    formData: async () => new FormData(),
    redirected: false,
    type: "basic",
    url: "",
  } as unknown as Response;
}

/** Build a text/plain error Response. */
export function makeTextResponse(
  text: string,
  status = 500,
  statusText = "Internal Server Error",
): Response {
  return {
    ok: false,
    status,
    statusText,
    json: async () => {
      throw new SyntaxError("Unexpected token");
    },
    headers: new Headers({ "content-type": "text/plain" }),
    body: null,
    bodyUsed: false,
    clone: () => makeTextResponse(text, status, statusText),
    text: async () => text,
    blob: async () => new Blob([text]),
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
    formData: async () => new FormData(),
    redirected: false,
    type: "basic",
    url: "",
  } as unknown as Response;
}
