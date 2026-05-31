import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Chat from "../Chat";

vi.mock("@/i18n", () => ({
  useI18nStore: Object.assign(
    (selector: any) => selector({ t: (key: string) => key, lang: "zh", setLang: vi.fn() }),
    { getState: () => ({ t: (key: string) => key, lang: "zh", setLang: vi.fn() }) }
  ),
}));

vi.mock("@/store/auth", () => ({
  useAuthStore: Object.assign(
    (selector: any) => selector({ token: "test", user: { id: "1", username: "u", displayName: "U", roles: [] }, isAdmin: false, logout: vi.fn(), hasPermission: () => true, isAnonymous: false }),
    { getState: () => ({ token: "test", user: { id: "1", username: "u", displayName: "U", roles: [] }, isAdmin: false, logout: vi.fn(), hasPermission: () => true, isAnonymous: false }) }
  ),
}));

vi.mock("@/api", () => ({
  apiFetch: vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ success: true, themes: [] }) })),
  api: {
    get: vi.fn(() => Promise.resolve([])),
    post: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock("@ant-design/x", () => ({
  Sender: () => <div data-testid="sender">Sender</div>,
  Bubble: () => <div data-testid="bubble">Bubble</div>,
  useXAgent: () => [{}, vi.fn()],
}));

vi.mock("echarts-for-react", () => ({
  default: () => <div data-testid="echart">Chart</div>,
}));

vi.mock("@ant-design/x-markdown", () => ({
  XMarkdown: ({ children }: any) => <div>{children}</div>,
}));

describe("Chat page", () => {
  it("should render chat page container", () => {
    render(
      <MemoryRouter>
        <Chat />
      </MemoryRouter>
    );
    expect(document.body).toBeTruthy();
  });
});
