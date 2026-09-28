import type { LogFileInfo } from '../types';
import type { LogStorage } from './LogStorage';

/** In-memory storage. Used for tests and as a web fallback when localStorage is unavailable. */
export class MemoryStorage implements LogStorage {
  readonly kind = 'memory' as const;
  protected namespace = 'logs';
  protected files = new Map<string, { text: string; modificationTime: number }>();

  async setDirectory(directory?: string): Promise<void> {
    this.namespace = directory || 'logs';
  }

  protected key(name: string) {
    return `${this.namespace}/${name}`;
  }

  async list(): Promise<LogFileInfo[]> {
    const prefix = `${this.namespace}/`;
    const result: LogFileInfo[] = [];
    this.files.forEach((file, key) => {
      if (!key.startsWith(prefix)) return;
      const name = key.slice(prefix.length);
      result.push({
        name,
        uri: `expo-logs://${key}`,
        size: byteLength(file.text),
        modificationTime: file.modificationTime,
      });
    });
    return result;
  }

  async append(name: string, text: string): Promise<void> {
    const key = this.key(name);
    const previous = this.files.get(key)?.text ?? '';
    this.files.set(key, { text: previous + text, modificationTime: Date.now() });
  }

  async read(name: string): Promise<string> {
    return this.files.get(this.key(name))?.text ?? '';
  }

  async readBytes(name: string): Promise<Uint8Array> {
    return encodeUtf8(await this.read(name));
  }

  async remove(name: string): Promise<void> {
    this.files.delete(this.key(name));
  }
}

export function byteLength(text: string): number {
  return encodeUtf8(text).length;
}

export function encodeUtf8(text: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
  const utf8 = unescape(encodeURIComponent(text));
  const bytes = new Uint8Array(utf8.length);
  for (let i = 0; i < utf8.length; i++) bytes[i] = utf8.charCodeAt(i);
  return bytes;
}
