import sanitizeHtml from 'sanitize-html';
import {
  ALLOWED_ATTRIBUTES,
  ALLOWED_SCHEMES,
  ALLOWED_TAGS,
  IMAGE_SCHEMES,
  parseMarkdown,
} from './markdown-rules.ts';

/**
 * Page body: Markdown → sanitised HTML, on the server. Pages are written by trusted editors, but
 * the HTML still ends up on a public page under the site's own origin, so it goes through the
 * allowlist all the same. The rules live in ./markdown-rules.ts, shared with the editor preview.
 */
export function renderMarkdown(src: string | null): string {
  if (!src?.trim()) return '';
  return sanitizeHtml(parseMarkdown(src), {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ALLOWED_SCHEMES,
    allowedSchemesByTag: { img: IMAGE_SCHEMES },
  });
}
