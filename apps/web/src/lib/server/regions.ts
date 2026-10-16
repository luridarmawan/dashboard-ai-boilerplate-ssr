import type { RequestEvent } from '@sveltejs/kit';
import { apiFor } from './session';

export interface RegionOption {
  readonly value: string;
  readonly label: string;
}

/**
 * `<select>` options for one level of the region picker: the children of `parent`, or the top
 * level (provinces) when `parent` is undefined. `null` means "no parent chosen yet": no options.
 * Any page can use it — the regions API is reference data that needs only a session.
 */
export async function regionOptions(
  event: RequestEvent,
  parent?: string | null,
): Promise<RegionOption[]> {
  if (parent === null || parent === '') return [];
  const res = await apiFor(event).v1.regions.get({ query: parent ? { parent } : {} });
  if (!res.data?.success) return [];
  return res.data.data.map((r) => ({ value: r.code, label: r.name }));
}

export { isRegionUnder, regionChain } from '../regions';
