import { describe, expect, test } from 'bun:test';
import { affectedRows } from '../src/affected-rows.ts';

/**
 * The scheduler lease (G-18) claims an interval when this returns exactly 1, so a driver shape
 * read wrongly does not throw — it silently stops every scheduled job. Each dialect's real
 * result shape is asserted here, including the two traps: postgres.js returns an Array SUBCLASS
 * that carries `count`, and bun:sqlite returns `changes` under a `void` type.
 */
describe('affectedRows — bentuk hasil tiap driver', () => {
  test('mysql2: [ResultSetHeader, fields]', () => {
    expect(affectedRows([{ affectedRows: 1, insertId: 0 }, undefined])).toBe(1);
    expect(affectedRows([{ affectedRows: 0 }, undefined])).toBe(0);
    expect(affectedRows([{ affectedRows: 7 }, []])).toBe(7);
  });

  test('postgres.js: RowList — sebuah Array yang juga membawa `count`', () => {
    const rowList = Object.assign([], { count: 1 });
    expect(affectedRows(rowList)).toBe(1);
    // Kalau `Array.isArray` diperiksa lebih dulu, baris 0 dibaca dan hasilnya 0 — justru bug
    // yang membuat penjadwal tidak pernah merasa menang.
    const withRows = Object.assign([{ id: 'x' }], { count: 3 });
    expect(affectedRows(withRows)).toBe(3);
  });

  test('bun:sqlite: { changes, lastInsertRowid } walau tipenya `void`', () => {
    expect(affectedRows({ changes: 1, lastInsertRowid: 42 })).toBe(1);
    expect(affectedRows({ changes: 0, lastInsertRowid: 0 })).toBe(0);
    expect(affectedRows({ changes: 9n, lastInsertRowid: 0 })).toBe(9);
  });

  test('bentuk tak dikenal dan nilai kosong tidak melempar, tapi menghasilkan 0', () => {
    expect(affectedRows(undefined)).toBe(0);
    expect(affectedRows(null)).toBe(0);
    expect(affectedRows([])).toBe(0);
    expect(affectedRows({})).toBe(0);
  });
});
