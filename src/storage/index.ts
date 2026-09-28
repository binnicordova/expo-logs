import { Directory, File, Paths } from 'expo-file-system';

import type { LogFileInfo } from '../types';
import type { LogStorage } from './LogStorage';

function toUri(directory: string): string {
  if (directory.startsWith('/')) return `file://${directory}`;
  return directory;
}

/** iOS / Android storage backed by the `expo-file-system` (SDK 54+) object API. */
export class FileSystemStorage implements LogStorage {
  readonly kind = 'file-system' as const;
  private directory: Directory | null = null;

  async setDirectory(directory?: string): Promise<void> {
    const dir = directory ? new Directory(toUri(directory)) : new Directory(Paths.cache, 'logs');
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    this.directory = dir;
  }

  private dir(): Directory {
    if (!this.directory) throw new Error('expo-logs: storage directory is not set');
    return this.directory;
  }

  private file(name: string): File {
    return new File(this.dir(), name);
  }

  async list(): Promise<LogFileInfo[]> {
    const dir = this.dir();
    if (!dir.exists) return [];
    const result: LogFileInfo[] = [];
    for (const entry of dir.list()) {
      if (!(entry instanceof File)) continue;
      result.push({
        name: entry.name,
        uri: entry.uri,
        size: entry.size ?? 0,
        modificationTime: entry.modificationTime ?? null,
      });
    }
    return result;
  }

  async append(name: string, text: string): Promise<void> {
    const file = this.file(name);
    if (!file.exists) {
      const dir = this.dir();
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
      file.create();
    }
    await file.write(text, { append: true });
  }

  async read(name: string): Promise<string> {
    const file = this.file(name);
    return file.exists ? file.text() : '';
  }

  async readBytes(name: string): Promise<Uint8Array> {
    const file = this.file(name);
    return file.exists ? file.bytes() : new Uint8Array(0);
  }

  async remove(name: string): Promise<void> {
    const file = this.file(name);
    if (file.exists) file.delete();
  }
}

export function createStorage(): LogStorage {
  return new FileSystemStorage();
}
