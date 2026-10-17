import { Marked } from 'marked';

/**
 * The ONE description of how a page body becomes HTML, shared by the API (which renders the
 * public page with sanitize-html) and the dashboard preview (which renders in the browser with
 * DOMPurify). Same parser, same options, same allowlist — so what the editor previews is what
 * visitors get. A private `Marked` instance: the AI module configures the global one.
 */
export const md = new Marked({
  gfm: true,
  // The page title is the only <h1>; a `# heading` in the body becomes an <h2>.
  walkTokens(token) {
    if (token.type === 'heading' && token.depth === 1) token.depth = 2;
  },
});

export const ALLOWED_TAGS = [
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

export const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'title'],
  th: ['align'],
  td: ['align'],
};

/** Link schemes: http(s) and mailto everywhere, http(s) only for images. */
export const ALLOWED_SCHEMES = ['http', 'https', 'mailto'];
export const IMAGE_SCHEMES = ['http', 'https'];

/** Markdown → unsanitised HTML. Never output this directly; each side sanitises it. */
export function parseMarkdown(src: string): string {
  return md.parse(src, { async: false }) as string;
}
