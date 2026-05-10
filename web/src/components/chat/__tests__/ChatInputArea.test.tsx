import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ChatInputArea from "../ChatInputArea";

vi.mock("@/i18n", () => ({
  useI18nStore: Object.assign(
    (selector: any) => selector({ t: (key: string) => key, lang: "zh", setLang: vi.fn() }),
    { getState: () => ({ t: (key: string) => key, lang: "zh", setLang: vi.fn() }) }
  ),
}));

vi.mock("@/api", () => ({
  apiFetch: vi.fn(),
}));

describe("ChatInputArea", () => {
  it("should render chat input container", () => {
    const { container } = render(<ChatInputArea loading={false} onSendMessage={vi.fn()} onStopChat={vi.fn()} />);
    expect(container.querySelector("div")).toBeInTheDocument();
  });

  it("should render stop button when loading", () => {
    render(<ChatInputArea loading={true} onSendMessage={vi.fn()} onStopChat={vi.fn()} />);
    expect(document.body.textContent).toContain("stop");
  });
});
