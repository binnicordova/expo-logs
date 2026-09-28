import { AppState, type NativeEventSubscription } from 'react-native';

import { sendByEmail, share } from './export';
import { defaultFormatter, formatArgs, inspect, utf8Length } from './format';
import type { LogStorage } from './storage/LogStorage';
import {
  LogLevel,
  type ConfigureOptions,
  type LogFileInfo,
  type LogFormatter,
  type SendByEmailOptions,
  type ShareOptions,
  type TaggedLogger,
} from './types';

type ConsoleMethod = 'debug' | 'log' | 'info' | 'warn' | 'error';
type ConsoleSnapshot = Record<ConsoleMethod, (...args: unknown[]) => void>;

interface ResolvedOptions {
  dailyRolling: boolean;
  maximumFileSize: number;
  maximumNumberOfFiles: number;
  logsDirectory?: string;
  logPrefix: string;
  flushInterval: number;
}

interface CurrentFile {
  name: string;
  size: number;
  day: string;
}

/** Lines kept in memory while `configure()` has not finished yet. */
const MAX_PENDING_BEFORE_CONFIGURE = 1000;
/** Flush right away once this many lines are buffered. */
const MAX_BUFFERED_LINES = 200;

const CONSOLE_LEVELS: Record<ConsoleMethod, LogLevel> = {
  debug: LogLevel.Debug,
  log: LogLevel.Info,
  info: LogLevel.Info,
  warn: LogLevel.Warning,
  error: LogLevel.Error,
};

function pad(n: number, width = 2) {
  return String(n).padStart(width, '0');
}

function localDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fileNameFor(prefix: string, date: Date): string {
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
  return `${prefix}${localDay(date)}_${time}.log`;
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The file logger. Use the shared `FileLogger` instance exported by the package;
 * the class is exported for advanced cases (several independent log sets, tests).
 */
export class Logger {
  private logLevel = LogLevel.Debug;
  private formatter: LogFormatter = defaultFormatter;
  private options: ResolvedOptions = {
    dailyRolling: true,
    maximumFileSize: 1024 * 1024,
    maximumNumberOfFiles: 5,
    logPrefix: '',
    flushInterval: 500,
  };
  private configured = false;
  private buffer: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private current: CurrentFile | null = null;
  private fileNamePattern = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}\.log$/;
  private originalConsole: ConsoleSnapshot | null = null;
  private appStateSubscription: NativeEventSubscription | null = null;
  private restoreErrorHandler: (() => void) | null = null;
  private inConsoleCapture = false;

  constructor(private readonly storage: LogStorage) {}

  /**
   * Prepares the log directory and starts writing. Messages logged before the returned
   * promise resolves are kept in memory and written once it does.
   */
  async configure(options: ConfigureOptions = {}): Promise<void> {
    const {
      logLevel = LogLevel.Debug,
      formatter = defaultFormatter,
      captureConsole = true,
      captureUnhandledErrors = false,
      dailyRolling = true,
      maximumFileSize = 1024 * 1024,
      maximumNumberOfFiles = 5,
      logsDirectory,
      logPrefix = '',
      flushInterval = 500,
    } = options;

    this.logLevel = logLevel;
    this.formatter = formatter;

    // Finish writing to the previous configuration first.
    if (this.configured) await this.flush();
    this.configured = false;

    this.options = {
      dailyRolling,
      maximumFileSize: Math.max(0, maximumFileSize),
      maximumNumberOfFiles: Math.max(0, maximumNumberOfFiles),
      logsDirectory,
      logPrefix,
      flushInterval: Math.max(0, flushInterval),
    };
    this.fileNamePattern = new RegExp(
      `^${escapeRegExp(logPrefix)}(\\d{4}-\\d{2}-\\d{2})_\\d{2}-\\d{2}-\\d{2}-\\d{3}\\.log$`
    );

    await this.storage.setDirectory(logsDirectory);
    this.current = await this.resumeCurrentFile();
    await this.enforceMaximumNumberOfFiles();
    this.configured = true;

    this.subscribeToAppState();
    if (captureConsole) this.enableConsoleCapture();
    else this.disableConsoleCapture();
    if (captureUnhandledErrors) this.enableErrorCapture();
    else this.disableErrorCapture();

    if (this.buffer.length > 0) await this.flush();
  }

  /** `true` once `configure()` has resolved. */
  isConfigured(): boolean {
    return this.configured;
  }

  // ---------------------------------------------------------------------------
  // Console capture

  /** Start appending `console.*` output to the log file. */
  enableConsoleCapture(): void {
    if (this.originalConsole) return;
    const original = {} as ConsoleSnapshot;
    (Object.keys(CONSOLE_LEVELS) as ConsoleMethod[]).forEach((method) => {
      const fn = console[method] as (...args: unknown[]) => void;
      original[method] = fn;
      console[method] = (...args: unknown[]) => {
        if (!this.inConsoleCapture) {
          this.inConsoleCapture = true;
          try {
            this.write(CONSOLE_LEVELS[method], formatArgs(args));
          } finally {
            this.inConsoleCapture = false;
          }
        }
        fn.apply(console, args);
      };
    });
    this.originalConsole = original;
  }

  /** Stop appending `console.*` output to the log file. */
  disableConsoleCapture(): void {
    if (!this.originalConsole) return;
    const original = this.originalConsole;
    (Object.keys(original) as ConsoleMethod[]).forEach((method) => {
      console[method] = original[method];
    });
    this.originalConsole = null;
  }

  isConsoleCaptureEnabled(): boolean {
    return this.originalConsole !== null;
  }

  // ---------------------------------------------------------------------------
  // Levels

  setLogLevel(logLevel: LogLevel): void {
    this.logLevel = logLevel;
  }

  getLogLevel(): LogLevel {
    return this.logLevel;
  }

  // ---------------------------------------------------------------------------
  // Writing

  debug(...args: unknown[]): void {
    this.write(LogLevel.Debug, formatArgs(args));
  }

  info(...args: unknown[]): void {
    this.write(LogLevel.Info, formatArgs(args));
  }

  warn(...args: unknown[]): void {
    this.write(LogLevel.Warning, formatArgs(args));
  }

  error(...args: unknown[]): void {
    this.write(LogLevel.Error, formatArgs(args));
  }

  /** Appends a message with the given level (if it passes the current log level). */
  write(level: LogLevel, msg: string): void {
    if (level < this.logLevel) return;
    let line: string;
    try {
      line = this.formatter(level, msg);
    } catch (error) {
      line = defaultFormatter(level, `${msg} (formatter failed: ${inspect(error)})`);
    }
    this.buffer.push(line + '\n');

    if (!this.configured) {
      if (this.buffer.length > MAX_PENDING_BEFORE_CONFIGURE) this.buffer.shift();
      return;
    }
    if (this.buffer.length >= MAX_BUFFERED_LINES || this.options.flushInterval === 0) {
      this.flushInBackground();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flushInBackground();
      }, this.options.flushInterval);
    }
  }

  /** Returns a logger that prefixes every message with `[tag]`. */
  createLogger(tag: string): TaggedLogger {
    const prefix = `[${tag}]`;
    return {
      debug: (...args) => this.debug(prefix, ...args),
      info: (...args) => this.info(prefix, ...args),
      warn: (...args) => this.warn(prefix, ...args),
      error: (...args) => this.error(prefix, ...args),
    };
  }

  /** Writes every buffered line to disk. Resolves when they are persisted. */
  flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.configured || this.buffer.length === 0) return this.queue;
    const lines = this.buffer.splice(0, this.buffer.length);
    return this.enqueue(() => this.persist(lines));
  }

  // ---------------------------------------------------------------------------
  // Files

  /** Log files, oldest first. */
  async getLogFiles(): Promise<LogFileInfo[]> {
    await this.flush();
    return this.enqueue(() => this.listLogFiles());
  }

  /**
   * URIs of the log files, oldest first. On iOS/Android these are `file://` URIs usable
   * with expo-file-system and expo-sharing.
   */
  async getLogFilePaths(): Promise<string[]> {
    return (await this.getLogFiles()).map((f) => f.uri);
  }

  /** Reads one log file by name or URI. Without argument, returns all files merged. */
  async readLogFile(nameOrUri?: string): Promise<string> {
    const files = await this.getLogFiles();
    if (!nameOrUri) {
      const parts: string[] = [];
      for (const file of files) parts.push(await this.storage.read(file.name));
      return parts.join('');
    }
    const file = files.find((f) => f.name === nameOrUri || f.uri === nameOrUri);
    return file ? this.storage.read(file.name) : '';
  }

  /** Deletes every log file (buffered lines are written first, then deleted too). */
  async deleteLogFiles(): Promise<void> {
    await this.flush();
    return this.enqueue(async () => {
      const files = await this.listLogFiles();
      for (const file of files) await this.storage.remove(file.name);
      this.current = null;
    });
  }

  /**
   * Opens the mail composer with the log files attached (expo-mail-composer).
   * Rejects with `ERR_MAIL_UNAVAILABLE` when no mail account is set up (e.g. iOS Simulator).
   * On web the logs are downloaded and a `mailto:` link is opened.
   */
  async sendLogFilesByEmail(options: SendByEmailOptions = {}): Promise<void> {
    const files = await this.getLogFiles();
    return sendByEmail(this.storage, files, this.options.logPrefix, options);
  }

  /** Opens the system share sheet with the logs (expo-sharing / Web Share API / download). */
  async shareLogFiles(options: ShareOptions = {}): Promise<void> {
    const files = await this.getLogFiles();
    return share(this.storage, files, this.options.logPrefix, options);
  }

  // ---------------------------------------------------------------------------
  // Internals

  /** Fire-and-forget flush; errors are already reported by `enqueue`. */
  private flushInBackground() {
    this.flush().catch(() => {});
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.then(
      () => undefined,
      (error) => this.reportInternalError(error)
    );
    return run;
  }

  private reportInternalError(error: unknown) {
    const warn = this.originalConsole?.warn ?? console.warn;
    try {
      warn.call(console, `[expo-logs] ${inspect(error)}`);
    } catch {
      // Never throw from the logger.
    }
  }

  private async listLogFiles(): Promise<LogFileInfo[]> {
    const files = await this.storage.list();
    return files
      .filter((f) => this.fileNamePattern.test(f.name))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  private dayOf(name: string): string {
    return this.fileNamePattern.exec(name)?.[1] ?? '';
  }

  private async resumeCurrentFile(): Promise<CurrentFile | null> {
    const files = await this.listLogFiles();
    const last = files[files.length - 1];
    if (!last) return null;
    const day = this.dayOf(last.name);
    const { dailyRolling, maximumFileSize } = this.options;
    if (dailyRolling && day !== localDay(new Date())) return null;
    if (maximumFileSize > 0 && last.size >= maximumFileSize) return null;
    return { name: last.name, size: last.size, day };
  }

  private newFileName(): string {
    const previous = this.current?.name ?? '';
    let time = Date.now();
    let name = fileNameFor(this.options.logPrefix, new Date(time));
    while (name <= previous) {
      time += 1;
      name = fileNameFor(this.options.logPrefix, new Date(time));
    }
    return name;
  }

  /** Whether `bytes` more must go to a new file, given `pendingBytes` not yet written to the current one. */
  private shouldRoll(pendingBytes: number, bytes: number): boolean {
    const current = this.current;
    if (!current) return true;
    if (this.options.dailyRolling && current.day !== localDay(new Date())) return true;
    const max = this.options.maximumFileSize;
    const size = current.size + pendingBytes;
    // `size > 0` guarantees a single line larger than the limit still gets written.
    return max > 0 && size > 0 && size + bytes > max;
  }

  private async persist(lines: string[]): Promise<void> {
    let chunk = '';
    let chunkBytes = 0;
    let rolled = false;

    const writeChunk = async () => {
      if (!chunk || !this.current) return;
      await this.storage.append(this.current.name, chunk);
      this.current.size += chunkBytes;
      chunk = '';
      chunkBytes = 0;
    };

    for (const line of lines) {
      const bytes = utf8Length(line);
      if (this.shouldRoll(chunkBytes, bytes)) {
        await writeChunk();
        this.current = { name: this.newFileName(), size: 0, day: localDay(new Date()) };
        rolled = true;
      }
      chunk += line;
      chunkBytes += bytes;
    }
    await writeChunk();
    if (rolled) await this.enforceMaximumNumberOfFiles();
  }

  private async enforceMaximumNumberOfFiles(): Promise<void> {
    const max = this.options.maximumNumberOfFiles;
    if (max <= 0) return;
    const files = await this.listLogFiles();
    // The current file may not exist on disk yet; count it so we keep `max` files in total.
    const currentPending =
      this.current && !files.some((f) => f.name === this.current!.name) ? 1 : 0;
    const excess = files.length + currentPending - max;
    for (let i = 0; i < excess; i++) {
      const file = files[i];
      if (file && file.name !== this.current?.name) await this.storage.remove(file.name);
    }
  }

  private subscribeToAppState() {
    if (this.appStateSubscription) return;
    try {
      this.appStateSubscription = AppState.addEventListener('change', (state) => {
        if (state !== 'active') this.flushInBackground();
      });
    } catch {
      // AppState is unavailable in some non-RN environments (SSR); flushing still happens on a timer.
    }
  }

  private enableErrorCapture() {
    if (this.restoreErrorHandler) return;
    const g = globalThis as {
      ErrorUtils?: {
        getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
        setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
      };
      addEventListener?: (type: string, listener: (event: any) => void) => void;
      removeEventListener?: (type: string, listener: (event: any) => void) => void;
      document?: unknown;
    };

    if (g.ErrorUtils?.getGlobalHandler) {
      const ErrorUtils = g.ErrorUtils;
      const previous = ErrorUtils.getGlobalHandler();
      const handler = (error: unknown, isFatal?: boolean) => {
        this.write(LogLevel.Error, `${isFatal ? 'Fatal' : 'Uncaught'} error: ${inspect(error)}`);
        this.flushInBackground();
        previous?.(error, isFatal);
      };
      ErrorUtils.setGlobalHandler(handler);
      this.restoreErrorHandler = () => ErrorUtils.setGlobalHandler(previous);
      return;
    }

    if (typeof g.addEventListener === 'function' && g.document) {
      const onError = (event: { error?: unknown; message?: string }) => {
        this.write(LogLevel.Error, `Uncaught error: ${inspect(event.error ?? event.message)}`);
        this.flushInBackground();
      };
      const onRejection = (event: { reason?: unknown }) => {
        this.write(LogLevel.Error, `Unhandled promise rejection: ${inspect(event.reason)}`);
        this.flushInBackground();
      };
      g.addEventListener('error', onError);
      g.addEventListener('unhandledrejection', onRejection);
      this.restoreErrorHandler = () => {
        g.removeEventListener?.('error', onError);
        g.removeEventListener?.('unhandledrejection', onRejection);
      };
    }
  }

  private disableErrorCapture() {
    this.restoreErrorHandler?.();
    this.restoreErrorHandler = null;
  }
}
