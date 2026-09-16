import { chmodSync, type Dirent, lstatSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Delete a directory tree that may contain a git checkout, on every platform this repo runs on.
 *
 * `fs.rm` is enough on Linux and macOS, and `rm -rf` is not available at all on a plain Windows
 * shell. The case that actually bites is a clone: git marks pack files (`.git/objects/pack/*.pack`,
 * `.idx`, `.rev`) read-only, and Windows refuses to unlink a read-only file — the deletion fails
 * with EPERM ("Permission denied") and leaves the tree half there. So: try the plain delete, and
 * only if that fails clear the read-only flag on everything and try again.
 */
export function removeDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    return;
  } catch {
    // Fall through to the slow path: something in there is not writable.
  }
  unlock(dir);
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

function unlock(path: string): void {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(path);
  } catch {
    return; // Gone already, or unreadable — the delete below will report what matters.
  }
  // Never chmod through a symlink: `chmod` follows it, and a module folder is full of links into
  // the shared node_modules store. Unlinking the link itself never needs the target to be writable.
  if (stat.isSymbolicLink()) return;
  try {
    chmodSync(path, 0o700);
  } catch {
    // Best effort: a file we cannot chmod is one the retry will fail on, with its own message.
  }
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) unlock(join(path, entry));
  }
}

/**
 * Unlink every symlink and junction inside a tree, without following a single one.
 *
 * Hand a directory to git — `git submodule deinit -f`, `git rm -r` — and git deletes it with its
 * own recursive walk. On Windows that walk goes straight *through* a junction: `bun install` links
 * workspace dependencies as junctions (`modules/Contact/node_modules/@core/db` → `packages/db`), so
 * uninstalling a module that way empties the core packages it happened to point at. `fs.rm` gets
 * this right, so clear the links out first and leave git a tree of plain files.
 */
export function removeLinks(dir: string): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // Not there, or unreadable: nothing to unlink.
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) rmSync(path, { force: true, recursive: true });
    else if (entry.isDirectory()) removeLinks(path);
  }
}
