/**
 * Google Analytics 4 through gtag.js. Loaded only after the visitor consented (or consent is not
 * required), from a script element — no inline script, so a strict CSP only needs to allow
 * `www.googletagmanager.com` and `*.google-analytics.com`. Page views are sent by hand
 * (`send_page_view: false`) because SvelteKit navigates client-side and the reported path is our
 * sanitised one, not the address bar.
 */

type Gtag = (...args: unknown[]) => void;
type GtagWindow = Window & { dataLayer?: unknown[]; gtag?: Gtag };

export interface PageInfo {
  /** Absolute URL with the sanitised path. */
  readonly location: string;
  readonly path: string;
  readonly title: string;
  readonly referrer: string;
}

let loadedId: string | null = null;

function gtag(...args: unknown[]): void {
  (window as GtagWindow).gtag?.(...args);
}

export const google = {
  load(id: string): void {
    if (loadedId === id) return;
    const w = window as GtagWindow;
    w.dataLayer = w.dataLayer ?? [];
    // gtag.js reads the Arguments object itself, not an array copy of it.
    w.gtag = function push() {
      // biome-ignore lint/complexity/noArguments: gtag.js requires the Arguments object
      w.dataLayer?.push(arguments);
    };
    // Advertising stays off whatever the visitor answered: this is analytics only.
    gtag('consent', 'default', {
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: 'granted',
    });
    gtag('js', new Date());
    gtag('config', id, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
    document.head.append(s);
    loadedId = id;
  },

  pageView(page: PageInfo): void {
    // `set` first: events gtag.js collects on its own (scrolls, outbound clicks) inherit the
    // sanitised location instead of reading the address bar.
    gtag('set', {
      page_location: page.location,
      page_path: page.path,
      page_title: page.title,
      page_referrer: page.referrer,
    });
    gtag('event', 'page_view', {
      page_location: page.location,
      page_path: page.path,
      page_title: page.title,
      page_referrer: page.referrer,
    });
  },

  event(name: string, params: Readonly<Record<string, string | number | boolean>>): void {
    // A beacon survives the navigation that often follows an event (logout, form submit).
    gtag('event', name, { ...params, transport_type: 'beacon' });
  },
};
