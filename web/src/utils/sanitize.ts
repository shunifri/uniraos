import DOMPurify from 'dompurify';

/**
 * Sanitize HTML content to prevent XSS attacks
 * @param html - Raw HTML string to sanitize
 * @returns Sanitized HTML string
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html);
}

/**
 * Check if content contains potentially dangerous HTML
 * @param html - HTML content to check
 * @returns true if content is safe, false if it contains dangerous code
 */
export function isHtmlSafe(html: string): boolean {
  const clean = DOMPurify.sanitize(html);
  return clean === html;
}

export default {
  sanitizeHtml,
  isHtmlSafe,
};
