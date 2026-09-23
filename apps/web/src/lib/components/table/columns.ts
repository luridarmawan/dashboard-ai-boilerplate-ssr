/**
 * DataTable declarations (PRD L-16). The table is presentation only: the page's `load` fetched
 * the rows for the current URL (page, limit, q, sort, order, cols); the table renders them and
 * emits plain links/forms for every interaction, so paging, sorting, search, column choice,
 * row actions and bulk actions all work without JavaScript (L-22).
 */
export interface ColumnDef<Row> {
  key: string;
  label: string;
  /** Sort key sent as `?sort=`; omit for an unsortable column. */
  sortKey?: string;
  /** Hidden until chosen in the column picker. */
  hidden?: boolean;
  align?: 'left' | 'right' | 'center';
  /** Cell text when no snippet is given. */
  value?: (row: Row) => string | number | null | undefined;
  class?: string;
}

/**
 * Icon-only row action: a square button whose `title` is the hover tooltip and whose `aria-label`
 * is the accessible name. A native tooltip, like the collapsed rail's (F-8) — a positioned one
 * would be clipped by the table's own horizontal scroll container. Exported because the pages
 * that build a plain `<Table>` by hand have to draw the same button as `DataTable`.
 */
export const iconActionClass =
  'ms-1 inline-flex h-8 w-8 items-center justify-center rounded-md border border-input align-middle text-foreground no-underline hover:bg-accent hover:text-accent-foreground hover:no-underline';

export interface RowAction<Row> {
  label: string;
  href?: (row: Row) => string;
  /** Form action URL for a POST (needs CSRF); rendered as a small form posting the row id. */
  action?: (row: Row) => string;
  icon?: string;
  /** Draw the icon alone; `label` becomes the hover tooltip and the accessible name. */
  iconOnly?: boolean;
  destructive?: boolean;
  /** Hide the action for rows where this returns false. */
  when?: (row: Row) => boolean;
}

export interface BulkAction {
  /** SvelteKit named action, e.g. `?/bulkDelete`. Selected ids post as `ids[]`. */
  action: string;
  label: string;
  icon?: string;
  destructive?: boolean;
  /**
   * Ask before acting (L-22). With JavaScript the click opens a modal whose form re-posts the
   * ticked ids to `<action>&confirm=<token>`; without it the plain submit reaches the action
   * unconfirmed, and the page is expected to answer with the same question inline (the ticked
   * ids travel in the form, so a `?confirm=` link cannot carry them the way `ConfirmDelete` does).
   * Either way the action must refuse a POST without the token (`confirmed()` in
   * `$lib/server/session`): a confirmation that lives only in the markup is not one.
   */
  confirm?: {
    token: string;
    title: string;
    /** Wording for the number of ticked rows. */
    lead: (count: number) => string;
    submitLabel: string;
  };
}

export interface TableState {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  q: string;
  sort: string;
  order: 'asc' | 'desc';
  /** Visible column keys, from `?cols=a,b` or a repeated `?cols=a&cols=b`; empty = defaults. */
  cols: string[];
  /**
   * Page-specific filters (e.g. `group` on /users), read from the URL by name. They travel with
   * every link and form the table emits, so sorting or paging never drops the active filter.
   * Empty values are absent, so `extra.group === undefined` means "not filtered".
   */
  extra?: Record<string, string>;
}

/** Parse the table's URL state with sane defaults; the page's `load` passes this to the API. */
export function tableStateFrom(
  url: URL,
  defaults: { sort: string; order?: 'asc' | 'desc'; limit?: number; extra?: string[] } = {
    sort: 'name',
  },
): Omit<TableState, 'total' | 'totalPages'> {
  const n = (k: string, d: number) => {
    const v = Number(url.searchParams.get(k));
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : d;
  };
  const order = url.searchParams.get('order');
  const extra: Record<string, string> = {};
  for (const k of defaults.extra ?? []) {
    const v = url.searchParams.get(k)?.trim();
    if (v) extra[k] = v;
  }
  return {
    extra,
    page: n('page', 1),
    limit: Math.min(n('limit', defaults.limit ?? 20), 100),
    q: url.searchParams.get('q') ?? '',
    sort: url.searchParams.get('sort') ?? defaults.sort,
    order: order === 'desc' ? 'desc' : order === 'asc' ? 'asc' : (defaults.order ?? 'asc'),
    /**
     * Two shapes reach us: the table's own links carry one compact `?cols=a,b`, while the column
     * picker is a set of checkboxes and posts a repeated `?cols=a&cols=b`. Reading only the first
     * value left the picker showing a single column, so accept both.
     */
    cols: [
      ...new Set(
        url.searchParams
          .getAll('cols')
          .flatMap((v) => v.split(','))
          .map((v) => v.trim())
          .filter(Boolean),
      ),
    ],
  };
}

/** Build a query string preserving the current state with some keys overridden. */
export function withParams(
  state: Partial<TableState>,
  patch: Record<string, string | number | undefined>,
): string {
  const p = new URLSearchParams();
  const base: Record<string, string | number | undefined> = {
    page: state.page,
    limit: state.limit,
    q: state.q || undefined,
    sort: state.sort,
    order: state.order,
    cols: state.cols?.length ? state.cols.join(',') : undefined,
    ...state.extra,
    ...patch,
  };
  for (const [k, v] of Object.entries(base)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '?';
}
