import type { LogFileInfo } from '../types';
import type { LogStorage } from './LogStorage';
import { MemoryStorage, byteLength } from './MemoryStorage';

const ROOT = 'expo-logs:';

function getLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const probe = `${ROOT}__probe__`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

function isQuotaError(error: unknown): boolean {
  const e = error as { name?: string; code?: number };
  return e?.name === 'QuotaExceededError' || e?.code === 22 || e?.code === 1014;
}

/**
 * Web storage: each log "file" is a localStorage entry. localStorage is limited
 * (~5 MB per origin), so when the quota is hit the oldest log files are dropped.
 */
export class WebStorage implements LogStorage {
  readonly kind = 'web' as const;
  private namespace = 'logs';

  constructor(private storage: Storage) {}

  async setDirectory(directory?: string): Promise<void> {
    this.namespace = directory || 'logs';
  }

  private prefix() {
    return `${ROOT}${this.namespace}/`;
  }

  private metaKey(name: string) {
    return `${ROOT}meta:${this.namespace}/${name}`;
  }

  async list(): Promise<LogFileInfo[]> {
    const prefix = this.prefix();
    const result: LogFileInfo[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      const name = key.slice(prefix.length);
      const text = this.storage.getItem(key) ?? '';
      const mtime = Number(this.storage.getItem(this.metaKey(name)));
      result.push({
        name,
        uri: `expo-logs://${this.namespace}/${name}`,
        size: byteLength(text),
        modificationTime: Number.isFinite(mtime) && mtime > 0 ? mtime : null,
      });
    }
    return result;
  }

  async append(name: string, text: string): Promise<void> {
    const key = this.prefix() + name;
    for (let attempt = 0; attempt < 10; attempt++) {
      const next = (this.storage.getItem(key) ?? '') + text;
      try {
        this.storage.setItem(key, next);
        this.storage.setItem(this.metaKey(name), String(Date.now()));
        return;
      } catch (error) {
        if (!isQuotaError(error)) throw error;
        const files = (await this.list())
          .filter((f) => f.name !== name)
          .sort((a, b) => a.name.localeCompare(b.name));
        const oldest = files[0];
        if (!oldest) {
          // Only the current file is left: keep its newest half.
          const current = this.storage.getItem(key) ?? '';
          this.storage.setItem(key, current.slice(Math.floor(current.length / 2)));
          continue;
        }
        await this.remove(oldest.name);
      }
    }
  }

  async read(name: string): Promise<string> {
    return this.storage.getItem(this.prefix() + name) ?? '';
  }

  async readBytes(name: string): Promise<Uint8Array> {
    return new TextEncoder().encode(await this.read(name));
  }

  async remove(name: string): Promise<void> {
    this.storage.removeItem(this.prefix() + name);
    this.storage.removeItem(this.metaKey(name));
  }
}

export function createStorage(): LogStorage {
  const ls = getLocalStorage();
  return ls ? new WebStorage(ls) : new MemoryStorage();
}
