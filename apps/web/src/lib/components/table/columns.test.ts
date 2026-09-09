import { describe, expect, test } from 'bun:test';
import { tableStateFrom, withParams } from './columns.ts';

/**
 * The table's URL state (L-16). The column picker is a set of checkboxes, so it posts one `cols`
 * value per checked column; the table's own links carry a single comma-joined `cols`. Both shapes
 * must parse, otherwise choosing columns in the picker leaves the table with just the first one.
 */
const state = (search: string) =>
  tableStateFrom(new URL(`http://x/users${search}`), { sort: 'name' });

describe('tableStateFrom', () => {
  test('reads the repeated cols the column picker posts', () => {
    expect(
      state(
        '?sort=name&order=asc&cols=name&cols=email&cols=groups&cols=status&cols=lastLogin&cols=created',
      ).cols,
    ).toEqual(['name', 'email', 'groups', 'status', 'lastLogin', 'created']);
  });

  test('reads the comma-joined cols the table links carry', () => {
    expect(state('?cols=name,email,groups').cols).toEqual(['name', 'email', 'groups']);
  });

  test('accepts a mix and drops blanks and duplicates', () => {
    expect(state('?cols=name,email&cols=&cols=email,+status').cols).toEqual([
      'name',
      'email',
      'status',
    ]);
  });

  test('no cols means "the defaults"', () => {
    expect(state('?sort=name').cols).toEqual([]);
  });

  test('round-trips through withParams', () => {
    const st = state('?cols=name&cols=email&limit=50');
    expect(withParams({ ...st, total: 0, totalPages: 1 }, {})).toContain('cols=name%2Cemail');
    expect(state(withParams({ ...st, total: 0, totalPages: 1 }, {})).cols).toEqual(st.cols);
  });
});
