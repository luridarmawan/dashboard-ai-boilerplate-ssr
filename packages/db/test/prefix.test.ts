import { describe, expect, test } from 'bun:test';
import { collectTableNames, migrationsTableFor, prefixSql } from '../src/migrate-prefix.ts';

const mysql = `CREATE TABLE \`clients\` (
\t\`id\` char(36) NOT NULL,
\t\`settings\` json,
\t\`client_id\` char(36),
\tCONSTRAINT \`clients_id\` PRIMARY KEY(\`id\`),
\tCONSTRAINT \`clients_code_uq\` UNIQUE(\`code\`)
);
--> statement-breakpoint
CREATE TABLE \`sessions\` (\`id\` char(36) NOT NULL, \`user_id\` char(36));
ALTER TABLE \`sessions\` ADD CONSTRAINT \`sessions_user_id_users_id_fk\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX \`sessions_user_id_idx\` ON \`sessions\` (\`user_id\`);
DROP INDEX \`sessions_user_id_idx\` ON \`sessions\`;
CREATE TABLE \`users\` (\`id\` char(36) NOT NULL);`;

const pg = `CREATE TABLE "clients" ("id" uuid PRIMARY KEY NOT NULL, "settings" jsonb);
ALTER TABLE "outbox_email" ADD CONSTRAINT "outbox_email_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_email_status_next_attempt_at_idx" ON "outbox_email" USING btree ("status","next_attempt_at");
CREATE TABLE "outbox_email" ("id" uuid);`;

const removal = `-- Uninstall modul AI (G-15)
DROP TABLE IF EXISTS \`ai_messages\`;--> statement-breakpoint
DROP TABLE IF EXISTS \`ai_conversations\`;--> statement-breakpoint
DELETE FROM \`modules\` WHERE \`module\` = 'AI';--> statement-breakpoint
DELETE FROM \`configurations\` WHERE \`key\` LIKE 'ai.%';--> statement-breakpoint
UPDATE \`users\` SET \`theme\` = NULL WHERE \`theme\` LIKE 'ai.%';--> statement-breakpoint
UPDATE \`cache_versions\` SET \`version\` = \`version\` + 1 WHERE \`name\` IN ('modules', 'configurations');`;

describe('TABLE_PREFIX for migrations (O-2)', () => {
  test('a G-15 removal migration is rewritten table by table, values untouched', () => {
    const tables = new Set([
      'ai_messages',
      'ai_conversations',
      'modules',
      'configurations',
      'users',
      'cache_versions',
    ]);
    const out = prefixSql(removal, 'x_', tables);
    expect(out).toContain('DROP TABLE IF EXISTS `x_ai_messages`;');
    expect(out).toContain('DROP TABLE IF EXISTS `x_ai_conversations`;');
    expect(out).toContain("DELETE FROM `x_modules` WHERE `module` = 'AI';");
    expect(out).toContain("DELETE FROM `x_configurations` WHERE `key` LIKE 'ai.%';");
    expect(out).toContain("UPDATE `x_users` SET `theme` = NULL WHERE `theme` LIKE 'ai.%';");
    expect(out).toContain(
      "UPDATE `x_cache_versions` SET `version` = `version` + 1 WHERE `name` IN ('modules', 'configurations');",
    );
    // the string literal 'modules' inside IN (...) is a value, not an identifier
    expect(out).not.toContain("'x_modules'");
  });
  test('collects every created table across files', () => {
    expect([...collectTableNames([mysql, pg])].sort()).toEqual([
      'clients',
      'outbox_email',
      'sessions',
      'users',
    ]);
  });
  test('mysql: tables, FK targets, constraint and index names get the prefix; columns do not', () => {
    const out = prefixSql(mysql, 'pfx_', collectTableNames([mysql]));
    expect(out).toContain('CREATE TABLE `pfx_clients`');
    expect(out).toContain('CONSTRAINT `pfx_clients_code_uq`');
    expect(out).toContain(
      'ALTER TABLE `pfx_sessions` ADD CONSTRAINT `pfx_sessions_user_id_users_id_fk`',
    );
    expect(out).toContain('REFERENCES `pfx_users`(`id`)');
    expect(out).toContain('CREATE INDEX `pfx_sessions_user_id_idx` ON `pfx_sessions`');
    expect(out).toContain('DROP INDEX `pfx_sessions_user_id_idx` ON `pfx_sessions`');
    expect(out).toContain('`settings` json'); // column named like nothing → untouched
    expect(out).toContain('`client_id` char(36)'); // column, not table `clients`
    expect(out).not.toContain('`pfx_client_id`');
    expect(out).not.toContain('`pfx_settings`');
  });
  test('pg: schema-qualified references keep "public" and prefix the table', () => {
    const out = prefixSql(pg, 'pfx_', collectTableNames([pg]));
    expect(out).toContain('CREATE TABLE "pfx_clients"');
    expect(out).toContain('REFERENCES "public"."pfx_clients"("id")');
    expect(out).toContain(
      'ALTER TABLE "pfx_outbox_email" ADD CONSTRAINT "pfx_outbox_email_client_id_clients_id_fk"',
    );
    expect(out).toContain(
      'CREATE INDEX "pfx_outbox_email_status_next_attempt_at_idx" ON "pfx_outbox_email"',
    );
    expect(out).toContain('"settings" jsonb');
  });
  test('empty prefix is the identity; journal table follows the prefix', () => {
    expect(prefixSql(mysql, '', collectTableNames([mysql]))).toBe(mysql);
    expect(migrationsTableFor('')).toBe('__drizzle_migrations');
    expect(migrationsTableFor('pfx_')).toBe('pfx___drizzle_migrations');
  });
});
