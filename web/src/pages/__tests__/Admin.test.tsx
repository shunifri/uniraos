import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Admin from "../Admin";

vi.mock("@/i18n", () => ({
  useI18nStore: Object.assign(
    (selector: any) => selector({ t: (key: string) => key, lang: "zh", setLang: vi.fn() }),
    { getState: () => ({ t: (key: string) => key, lang: "zh", setLang: vi.fn() }) }
  ),
}));

vi.mock("@/store/auth", () => ({
  useAuthStore: Object.assign(
    (selector: any) => selector({ token: "test", user: { id: "1", username: "u", displayName: "U", roles: [{ name: "admin" }] }, isAdmin: true, hasPermission: () => true }),
    { getState: () => ({ token: "test", user: { id: "1", username: "u", displayName: "U", roles: [{ name: "admin" }] }, isAdmin: true, hasPermission: () => true }) }
  ),
}));

vi.mock("@/api", () => ({
  api: {
    get: vi.fn(() => Promise.resolve({ users: [], roles: [], departments: [], resources: [] })),
    post: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  },
}));

describe("Admin page", () => {
  it("should render admin page for admin user", () => {
    render(
      <MemoryRouter>
        <Admin />
      </MemoryRouter>
    );
    expect(document.body).toBeTruthy();
  });
});
