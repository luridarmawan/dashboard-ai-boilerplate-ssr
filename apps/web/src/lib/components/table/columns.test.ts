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

  test('reads only the named extra filters, dropping blanks', () => {
    const st = tableStateFrom(new URL('http://x/users?group=g1&status=1&q=a&other=z'), {
      sort: 'name',
      extra: ['group', 'status', 'missing'],
    });
    expect(st.extra).toEqual({ group: 'g1', status: '1' });
    expect(
      tableStateFrom(new URL('http://x/users?group=+'), { sort: 'name', extra: ['group'] }).extra,
    ).toEqual({});
    // Without a list nothing is read: pages that have no filters see an empty object.
    expect(state('?group=g1').extra).toEqual({});
  });

  test('extra filters ride along every link and can be patched away', () => {
    const st = { ...state('?q=a'), extra: { group: 'g1' }, total: 0, totalPages: 1 };
    expect(withParams(st, { page: 2 })).toContain('group=g1');
    expect(withParams(st, { group: undefined })).not.toContain('group=');
  });

  test('round-trips through withParams', () => {
    const st = state('?cols=name&cols=email&limit=50');
    expect(withParams({ ...st, total: 0, totalPages: 1 }, {})).toContain('cols=name%2Cemail');
    expect(state(withParams({ ...st, total: 0, totalPages: 1 }, {})).cols).toEqual(st.cols);
  });
});
