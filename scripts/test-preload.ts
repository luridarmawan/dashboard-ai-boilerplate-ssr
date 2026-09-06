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
