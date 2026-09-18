/**
 * Test preload (bunfig.toml [test].preload): unit tests exercise the API in-process without a
 * database, but request handlers read the validated env (`env()`), which requires DATABASE_URL.
 * Provide placeholders ONLY when nothing is configured — integration runs (INTEGRATION=1) set
 * real values and are left untouched. Nothing connects to these placeholders: unit tests never
 * reach the database, and a wrong-dialect or unreachable URL fails loudly if one ever does.
 */
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'mysql://unit:unit@127.0.0.1:1/unit';
  process.env.DB_DIALECT ??= 'mysql';
  process.env.SCHEDULER_ENABLED ??= 'false';
}

/**
 * The same idea for the two settings a developer's own `.env` would otherwise decide: `bun test`
 * reads `.env`, and these are read at runtime by code the unit tests assert against — an
 * installation with `TABLE_PREFIX=test_` sees `tenantTables` as `test_groups` and the tenant guard
 * tests fail, and any `APP_ORIGIN` allow-list rejects the `http://api.test` origin the CSRF
 * ordering test sends, so 403 arrives where 422 was expected. Those are five red tests that say
 * nothing about the code, on the machine of whoever configured their app.
 *
 * Unit tests assert the defaults, so the defaults are what they get. A test that cares about
 * either value sets it itself and restores it (`packages/db/test/prefix.test.ts`,
 * `apps/api/test/public-link.test.ts`). Integration runs keep the real configuration: they talk
 * to the database and the origins the operator configured, which is the point of them.
 */
if (process.env.INTEGRATION !== '1') {
  delete process.env.TABLE_PREFIX;
  delete process.env.APP_ORIGIN;
}
