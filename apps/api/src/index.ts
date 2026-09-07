// Entry point for both `bun apps/api/src/index.ts [cmd]` and the compiled binary (Q-2).
import { main } from './cli.ts';

try {
  const code = await main(process.argv.slice(2));
  if (code >= 0) process.exit(code);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
