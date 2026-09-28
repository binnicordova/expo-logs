import type { LogFileInfo } from '../types';

/**
 * Minimal persistence contract used by the logger. Implementations exist for
 * expo-file-system (iOS/Android), localStorage (web) and memory (tests / SSR).
 */
export interface LogStorage {
  readonly kind: 'file-system' | 'web' | 'memory';
  /** Selects (and creates, if needed) the directory that holds the log files. */
  setDirectory(directory?: string): Promise<void>;
  /** Lists every file in the directory (not only log files). */
  list(): Promise<LogFileInfo[]>;
  /** Appends UTF-8 text to a file, creating it when missing. */
  append(name: string, text: string): Promise<void>;
  read(name: string): Promise<string>;
  readBytes(name: string): Promise<Uint8Array>;
  remove(name: string): Promise<void>;
}
