import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export async function saveDispatchFile(path: string, value: unknown) {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(value, null, 2) + "\n"); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, path);
    const folder = await open(dir, "r");
    try { await folder.sync(); } finally { await folder.close(); }
  } finally { await unlink(temporary).catch(() => {}); }
}

// A single process owns each directory. Serializes writes, never network operations.
export class DispatchLock {
  private pending = new Map<string, Promise<unknown>>();
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(key) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(fn);
    this.pending.set(key, task);
    try { return await task; }
    finally { if (this.pending.get(key) === task) this.pending.delete(key); }
  }
}
