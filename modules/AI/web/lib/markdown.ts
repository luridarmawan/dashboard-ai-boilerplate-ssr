import { marked } from 'marked';

/**
 * Markdown → sanitized HTML for assistant replies (H-8). Two pure-JS sanitisers, one per side:
 * `sanitize-html` on the server (history, no-JS path) and `DOMPurify` in the browser (streaming).
 * Both use the same allowlist. Neither drags a DOM implementation into the SSR bundle.
 */
marked.setOptions({ gfm: true, breaks: true });

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
  'h1',
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
  'span',
];

async function sanitize(html: string): Promise<string> {
  if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
    const { default: sanitizeHtml } = await import('sanitize-html');
    return sanitizeHtml(html, {
      allowedTags: ALLOWED_TAGS,
      allowedAttributes: {
        a: ['href', 'title'],
        code: ['class'],
        img: ['src', 'alt', 'title'],
        th: ['align'],
        td: ['align'],
      },
      allowedSchemes: ['http', 'https', 'mailto'],
      allowedSchemesByTag: { img: ['http', 'https'] },
    });
  }
  const { default: DOMPurify } = await import('dompurify');
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ['href', 'title', 'class', 'src', 'alt', 'align'],
    ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
  });
}

export async function renderMarkdown(src: string): Promise<string> {
  const raw = marked.parse(src, { async: false }) as string;
  const clean = await sanitize(raw);
  return clean
    .replace(/<a /g, '<a target="_blank" rel="noopener noreferrer nofollow" ')
    .replace(
      /<pre><code class="language-([\w-]+)">/g,
      '<pre class="code-block" data-lang="$1"><code class="language-$1">',
    )
    .replace(/<pre>/g, '<pre class="code-block">');
}
