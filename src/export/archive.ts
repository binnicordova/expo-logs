import { zipSync } from 'fflate';

import type { LogStorage } from '../storage/LogStorage';
import type { LogFileInfo } from '../types';

/** Builds a .zip (pure JS, via fflate) containing the given log files. */
export async function buildZip(storage: LogStorage, files: LogFileInfo[]): Promise<Uint8Array> {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    entries[file.name] = await storage.readBytes(file.name);
  }
  return zipSync(entries, { level: 6 });
}

/** Concatenates the given log files into one text, with a header per file. */
export async function buildMergedText(storage: LogStorage, files: LogFileInfo[]): Promise<string> {
  const parts: string[] = [];
  for (const file of files) {
    const text = await storage.read(file.name);
    parts.push(files.length > 1 ? `===== ${file.name} =====\n${text}` : text);
  }
  return parts.join('\n');
}
