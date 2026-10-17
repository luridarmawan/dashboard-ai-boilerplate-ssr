import { Marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

/**
 * Page body: Markdown → sanitised HTML, on the server only. Pages are written by trusted editors,
 * but the HTML still ends up on a public page under the site's own origin, so it goes through an
 * allowlist all the same. A private `Marked` instance: the AI module configures the global one.
 */
const md = new Marked({ gfm: true });

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'del',
  'a',
  'ul',
  'ol',
  'li',
  'blockquote',
  'code',
  'pre',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'hr',
  'img',
];

export function renderMarkdown(src: string | null): string {
  if (!src?.trim()) return '';
  const raw = md.parse(src, { async: false }) as string;
  return sanitizeHtml(raw, {
    allowedTags: ALLOWED_TAGS,
    // The page title is the only <h1>; a `# heading` in the body becomes an <h2>.
    transformTags: { h1: 'h2' },
    allowedAttributes: {
      a: ['href', 'title'],
      img: ['src', 'alt', 'title'],
      th: ['align'],
      td: ['align'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https'] },
  });
}
