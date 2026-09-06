import { describe, expect, test } from 'bun:test';
import { renderMarkdown } from '../web/lib/markdown.ts';

describe('assistant markdown is rendered AND sanitized (H-8)', () => {
  test('markdown → HTML with code blocks tagged for highlighting/copy', async () => {
    const html = await renderMarkdown('Hi **there**\n\n```ts\nconst a = 1;\n```');
    expect(html).toContain('<strong>there</strong>');
    expect(html).toContain('<pre class="code-block" data-lang="ts"><code class="language-ts">');
  });
  test('scripts, event handlers and javascript: links are stripped', async () => {
    const html = await renderMarkdown(
      '<script>alert(1)</script><img src=x onerror=alert(1)>[x](javascript:alert(1))<a href="https://ok.test">ok</a>',
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });
});
