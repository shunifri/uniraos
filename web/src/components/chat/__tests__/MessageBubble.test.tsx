import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import MessageBubble from "../MessageBubble";

// Mock complex dependencies
vi.mock("echarts-for-react", () => ({
  default: () => <div data-testid="echart">Chart</div>,
}));

vi.mock("@ant-design/x-markdown", () => ({
  XMarkdown: ({ children }: any) => <div data-testid="markdown">{children}</div>,
}));

vi.mock("@ant-design/x", () => ({
  Bubble: ({ children }: any) => <div data-testid="bubble">{children}</div>,
}));

vi.mock("@/i18n", () => ({
  useI18nStore: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/ConfirmCard", () => ({
  default: ({ confirmId }: any) => <div data-testid="confirm-card">{confirmId}</div>,
}));

describe("MessageBubble", () => {
  const baseMsg = {
    id: "1",
    role: "assistant" as const,
    content: "Hello world",
    timestamp: Date.now(),
  };

  it("should render assistant message", () => {
    render(
      <MessageBubble
        msg={baseMsg}
        confirmedCards={new Set()}
        mdPreviews={{}}
        onViewKbDoc={vi.fn()}
        onConfirmCard={vi.fn()}
      />
    );
    expect(screen.getByTestId("bubble")).toBeInTheDocument();
  });

  it("should render user message", () => {
    render(
      <MessageBubble
        msg={{ ...baseMsg, role: "user" as const }}
        confirmedCards={new Set()}
        mdPreviews={{}}
        onViewKbDoc={vi.fn()}
        onConfirmCard={vi.fn()}
      />
    );
    expect(screen.getByTestId("bubble")).toBeInTheDocument();
  });

  it("should render confirm card for user_confirm role", () => {
    render(
      <MessageBubble
        msg={{
          ...baseMsg,
          role: "user_confirm" as const,
          content: JSON.stringify({ confirmId: "c1", type: "text", title: "Confirm?" }),
        }}
        confirmedCards={new Set()}
        mdPreviews={{}}
        onViewKbDoc={vi.fn()}
        onConfirmCard={vi.fn()}
      />
    );
    expect(screen.getByTestId("confirm-card")).toHaveTextContent("c1");
  });

  it("should show error text for invalid confirm card JSON", () => {
    render(
      <MessageBubble
        msg={{
          ...baseMsg,
          role: "user_confirm" as const,
          content: "invalid-json",
        }}
        confirmedCards={new Set()}
        mdPreviews={{}}
        onViewKbDoc={vi.fn()}
        onConfirmCard={vi.fn()}
      />
    );
    expect(screen.getByText("确认卡片数据解析失败")).toBeInTheDocument();
  });
});
