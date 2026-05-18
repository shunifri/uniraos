import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";

const lockMap = new Map<string, Promise<void>>();

async function acquireLock(key: string): Promise<() => void> {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = () => {
      lockMap.delete(key);
      resolve();
    };
  });
  const previous = lockMap.get(key);
  lockMap.set(key, previous ? previous.then(() => promise) : promise);
  if (previous) await previous;
  return release;
}

export async function withPlanLock<T>(
  filePath: string,
  operation: () => T | Promise<T>
): Promise<T> {
  const release = await acquireLock(filePath);
  try { return await operation(); } finally { release(); }
}

export function readPlanFileLocked(filePath: string): string {
  return readFileSync(filePath, "utf-8");
}

export function writePlanFileLocked(filePath: string, content: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, content, "utf-8");
}
