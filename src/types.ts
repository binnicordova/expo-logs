/**
 * Log severity. Numeric values match `react-native-file-logger`, so persisted
 * settings and comparisons keep working after migrating.
 */
export enum LogLevel {
  Debug = 0,
  Info = 1,
  Warning = 2,
  Error = 3,
}

/** Turns a level and a message into the line written to the log file (without trailing newline). */
export type LogFormatter = (level: LogLevel, msg: string) => string;

export interface ConfigureOptions {
  /** Minimum level written to the file. Does not affect console output. @default LogLevel.Debug */
  logLevel?: LogLevel;
  /** Line formatter. @default `${ISO date} [LEVEL]  ${msg}` */
  formatter?: LogFormatter;
  /** Mirror every `console.debug/log/info/warn/error` call into the log file. @default true */
  captureConsole?: boolean;
  /** Also record uncaught JS errors (and unhandled rejections on web). @default false */
  captureUnhandledErrors?: boolean;
  /** Start a new file when the local date changes. @default true */
  dailyRolling?: boolean;
  /** Start a new file when the current one would exceed this many bytes. `0` disables. @default 1048576 (1 MB) */
  maximumFileSize?: number;
  /** Keep at most this many files; the oldest are deleted. `0` disables. @default 5 */
  maximumNumberOfFiles?: number;
  /**
   * Directory for the log files, as a `file://` URI or an absolute path.
   * Native default: `<cache>/logs`. On web it is only used as a storage namespace.
   */
  logsDirectory?: string;
  /** Prefix added to every log file name. @default '' */
  logPrefix?: string;
  /** Milliseconds to batch writes before flushing to disk. @default 500 */
  flushInterval?: number;
}

export interface SendByEmailOptions {
  to?: string | string[];
  subject?: string;
  body?: string;
  /** Attach a single `.zip` instead of the individual `.log` files. @default false */
  compressFiles?: boolean;
}

export interface ShareOptions {
  /** Share a `.zip` archive. When `false` and there are several files, they are merged into one `.log`. @default false */
  compressFiles?: boolean;
  /** Android share sheet / web share title. */
  dialogTitle?: string;
}

export interface LogFileInfo {
  /** File name, e.g. `app-2026-09-28_10-15-00-123.log`. */
  name: string;
  /** `file://` URI on iOS/Android; a virtual `expo-logs://` URI on web. */
  uri: string;
  /** Size in bytes. */
  size: number;
  /** Last modification time in ms since epoch, when known. */
  modificationTime: number | null;
}

/** A small tagged logger returned by `FileLogger.createLogger(tag)`. */
export interface TaggedLogger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export class ExpoLogsError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ExpoLogsError';
    this.code = code;
  }
}
