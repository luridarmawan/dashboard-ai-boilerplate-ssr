import { describe, expect, test } from 'bun:test';
import {
  BREAKPOINT,
  cleanupStatements,
  dropStatements,
  moduleTablesFromSnapshot,
  orderForDrop,
  renderRemovalMigration,
  splitStatements,
  unrelatedStatements,
} from '../src/remove.ts';

/** An AI-shaped snapshot: messages → conversations, attachments → messages + core files, tools → mcps. */
const fk = (from: string, to: string) => ({
  [`${from}_${to}_fk`]: { tableFrom: from, tableTo: to },
});
const snapshot = {
  tables: {
    'public.ai_attachments': {
      name: 'ai_attachments',
      foreignKeys: { ...fk('ai_attachments', 'ai_messages'), ...fk('ai_attachments', 'files') },
    },
    'public.ai_conversations': {
      name: 'ai_conversations',
      foreignKeys: { ...fk('ai_conversations', 'users') },
    },
    'public.ai_messages': {
      name: 'ai_messages',
      foreignKeys: { ...fk('ai_messages', 'ai_conversations') },
    },
    'public.ai_mcp_tools': {
      name: 'ai_mcp_tools',
      foreignKeys: { ...fk('ai_mcp_tools', 'ai_mcps') },
    },
    'public.ai_mcps': { name: 'ai_mcps', foreignKeys: {} },
    'public.ai_calls': { name: 'ai_calls' },
    // not the module's: a core table and another module sharing a letter
    'public.users': { name: 'users', foreignKeys: {} },
    'public.aix_other': { name: 'aix_other', foreignKeys: {} },
  },
};

describe('moduleTablesFromSnapshot', () => {
  test('selects <ns>_ tables only and keeps intra-module references', () => {
    const t = moduleTablesFromSnapshot(snapshot, 'ai');
    expect(t.map((x) => x.name)).toEqual([
      'ai_attachments',
      'ai_calls',
      'ai_conversations',
      'ai_mcp_tools',
      'ai_mcps',
      'ai_messages',
    ]);
    expect(t.find((x) => x.name === 'ai_attachments')?.dependsOn).toEqual(['ai_messages']); // `files` is core
    expect(t.find((x) => x.name === 'ai_conversations')?.dependsOn).toEqual([]); // `users` is core
    expect(t.find((x) => x.name === 'ai_messages')?.dependsOn).toEqual(['ai_conversations']);
  });
});

describe('orderForDrop', () => {
  test('children first: every table is dropped after the tables that reference it', () => {
    const order = orderForDrop(moduleTablesFromSnapshot(snapshot, 'ai'));
    const at = (n: string) => order.indexOf(n);
    expect(at('ai_attachments')).toBeLessThan(at('ai_messages'));
    expect(at('ai_messages')).toBeLessThan(at('ai_conversations'));
    expect(at('ai_mcp_tools')).toBeLessThan(at('ai_mcps'));
    expect(order.length).toBe(6);
    expect(new Set(order).size).toBe(6);
  });
  test('deterministic and alphabetical among peers', () => {
    expect(
      orderForDrop([
        { name: 'x_b', dependsOn: [] },
        { name: 'x_a', dependsOn: [] },
      ]),
    ).toEqual(['x_a', 'x_b']);
  });
  test('a cycle still terminates with every table listed once', () => {
    const order = orderForDrop([
      { name: 'x_a', dependsOn: ['x_b'] },
      { name: 'x_b', dependsOn: ['x_a'] },
    ]);
    expect(order.sort()).toEqual(['x_a', 'x_b']);
  });
});

describe('statements', () => {
  test('MySQL drops are plain IF EXISTS; PostgreSQL adds CASCADE', () => {
    expect(dropStatements('mysql', ['ai_messages'])).toEqual([
      'DROP TABLE IF EXISTS `ai_messages`;',
    ]);
    expect(dropStatements('pg', ['ai_messages'])).toEqual([
      'DROP TABLE IF EXISTS "ai_messages" CASCADE;',
    ]);
  });
  test('cleanup touches exactly the core tables a module can leave rows in, namespaced', () => {
    const sql = cleanupStatements('mysql', { name: 'AI', ns: 'ai' }).join('\n');
    expect(sql).toContain("DELETE FROM `modules` WHERE `module` = 'AI';");
    expect(sql).toContain("DELETE FROM `configurations` WHERE `key` LIKE 'ai.%';");
    expect(sql).toContain("DELETE FROM `group_permissions` WHERE `permission` LIKE 'ai.%';");
    expect(sql).toContain("DELETE FROM `scheduler_jobs` WHERE `name` LIKE 'ai.%';");
    expect(sql).toContain("DELETE FROM `scheduler_runs` WHERE `job` LIKE 'ai.%';");
    expect(sql).toContain("DELETE FROM `queue_jobs` WHERE `name` LIKE 'ai.%';");
    expect(sql).toContain("`type` LIKE 'ai.%' OR `link` LIKE '/m/ai/%'");
    expect(sql).toContain("UPDATE `users` SET `theme` = NULL WHERE `theme` LIKE 'ai.%';");
    expect(sql).toContain("IN ('modules', 'configurations')");
    // never the audit log, never files (objects live in the storage adapter)
    expect(sql).not.toContain('audit_log');
    expect(sql).not.toContain('`files`');
    // PostgreSQL quoting
    expect(cleanupStatements('pg', { name: 'AI', ns: 'ai' })[0]).toBe(
      `DELETE FROM "modules" WHERE "module" = 'AI';`,
    );
  });
});

describe('renderRemovalMigration', () => {
  test('header, kept unrelated statements, drops in order, then cleanup — breakpoint-separated', () => {
    const tables = orderForDrop(moduleTablesFromSnapshot(snapshot, 'ai'));
    const generated = [
      'DROP TABLE `ai_conversations`;',
      'DROP TABLE `ai_messages`;',
      'ALTER TABLE `users` ADD `nickname` varchar(64);',
    ].join(`${BREAKPOINT}\n`);
    const keep = unrelatedStatements(generated, tables);
    expect(keep).toEqual(['ALTER TABLE `users` ADD `nickname` varchar(64);']);
    const sql = renderRemovalMigration({ dialect: 'mysql', name: 'AI', ns: 'ai', tables }, keep);
    expect(sql.startsWith('-- Uninstall modul AI (G-15)')).toBe(true);
    const stmts = splitStatements(sql);
    // the header rides on the first statement; strip comment lines for the comparison
    const first = stmts[0]
      ?.split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n');
    expect(first).toBe('ALTER TABLE `users` ADD `nickname` varchar(64);');
    expect(stmts[1]).toBe('DROP TABLE IF EXISTS `ai_attachments`;');
    expect(stmts.at(-1)).toContain('cache_versions');
    // every module table appears exactly once as a DROP
    for (const t of tables)
      expect(sql.match(new RegExp(`DROP TABLE IF EXISTS \\\`${t}\\\``, 'g'))?.length).toBe(1);
  });
});
