import DOMPurify from 'dompurify';
import { ALLOWED_ATTRIBUTES, ALLOWED_TAGS, parseMarkdown } from '../../api/markdown-rules.ts';

/**
 * Browser half of the page renderer: same Markdown rules as the API (../../api/markdown-rules.ts),
 * sanitised with DOMPurify instead of sanitize-html. Loaded on demand by the editor, so marked
 * and DOMPurify never weigh on the dashboard's first load.
 */
const ATTRS = [...new Set(Object.values(ALLOWED_ATTRIBUTES).flat())];

export function renderPreview(src: string): string {
  if (!src.trim()) return '';
  return DOMPurify.sanitize(parseMarkdown(src), {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ATTRS,
    ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
  });
}
