/**
 * The Indonesian regions data set shipped with the repository. Imported as a `file` asset so
 * `bun build --compile` embeds it in the production binary: `api regions` works in the image
 * without mounting anything. Kept in its own module so only that command loads it.
 */
import bundled from '../../../packages/db/data/regions-id.tsv.gz' with { type: 'file' };

export const BUNDLED_REGIONS: { readonly path: string; readonly name: string } = {
  path: bundled,
  name: 'regions-id.tsv.gz',
};
