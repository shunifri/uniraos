import { CodeHighlighter, Think } from "@ant-design/x";

// ---- XMarkdown custom components (plugins) ----
export const markdownComponents: Record<string, React.ComponentType<any>> = {
  code: ({ children, lang, block }: any) =>
    block ? (
      <CodeHighlighter lang={lang}>{String(children ?? "")}</CodeHighlighter>
    ) : (
      <code style={{ background: "var(--ant-color-fill-tertiary)", padding: "1px 4px", borderRadius: 3, fontSize: "0.9em" }}>{children}</code>
    ),
  think: ({ children, streamStatus }: any) => (
    <Think title="Thinking..." loading={streamStatus === "loading"}>{children}</Think>
  ),
};
