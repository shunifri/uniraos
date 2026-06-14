import { XMarkdown } from "@ant-design/x-markdown";
import DOMPurify from 'dompurify';
import { markdownComponents } from "./chat/MarkdownConfig";

interface SafeXMarkdownProps {
  content: string;
  components?: Record<string, React.ComponentType<any>>;
  streaming?: { hasNextChunk: boolean };
  openLinksInNewTab?: boolean;
}

/**
 * SafeXMarkdown - XMarkdown wrapper with DOMPurify XSS protection
 * All markdown content is sanitized before rendering to prevent XSS attacks
 */
export default function SafeXMarkdown({
  content,
  components = {},
  streaming,
  openLinksInNewTab = true,
}: SafeXMarkdownProps) {
  // Sanitize content before rendering
  const sanitizedContent = DOMPurify.sanitize(content);

  const mergedComponents = {
    ...markdownComponents,
    ...components,
  };

  return (
    <XMarkdown
      content={sanitizedContent}
      components={mergedComponents}
      streaming={streaming}
      openLinksInNewTab={openLinksInNewTab}
    />
  );
}
