import { Logger } from '../Logger';
import { MemoryStorage } from '../storage/MemoryStorage';
import { LogLevel } from '../types';

jest.mock('expo-file-system', () => ({ Directory: jest.fn(), File: jest.fn(), Paths: {} }));

const plain = (level: LogLevel, msg: string) => `${level}|${msg}`;

async function createLogger(options: Parameters<Logger['configure']>[0] = {}) {
  const storage = new MemoryStorage();
  const logger = new Logger(storage);
  await logger.configure({ captureConsole: false, formatter: plain, ...options });
  return { logger, storage };
}

describe('Logger', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('writes lines at or above the log level', async () => {
    const { logger } = await createLogger({ logLevel: LogLevel.Info });
    logger.debug('hidden');
    logger.info('shown', 1);
    logger.warn('warned');
    logger.error('failed');
    expect(await logger.readLogFile()).toBe('1|shown 1\n2|warned\n3|failed\n');

    logger.setLogLevel(LogLevel.Error);
    expect(logger.getLogLevel()).toBe(LogLevel.Error);
    logger.warn('ignored');
    expect(await logger.readLogFile()).not.toContain('ignored');
  });

  it('keeps messages logged before configure() resolves', async () => {
    const logger = new Logger(new MemoryStorage());
    // Formatted at call time with the default formatter, so the timestamp is accurate.
    logger.write(LogLevel.Info, 'early');
    await logger.configure({ captureConsole: false, formatter: plain });
    logger.info('late');
    expect(await logger.readLogFile()).toMatch(/^\S+Z \[INFO\] {2}early\n1\|late\n$/);
  });

  it('batches writes and flushes after flushInterval', async () => {
    jest.useFakeTimers();
    const { logger, storage } = await createLogger({ flushInterval: 1000 });
    const append = jest.spyOn(storage, 'append');
    logger.info('a');
    logger.info('b');
    expect(append).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1000);
    await logger.flush();
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0]![1]).toBe('1|a\n1|b\n');
  });

  it('rolls files by size and keeps maximumNumberOfFiles', async () => {
    // Each line is "1|xxxxxxxx\n" = 11 bytes, so two lines fit in 25 bytes.
    const { logger } = await createLogger({ maximumFileSize: 25, maximumNumberOfFiles: 3 });
    for (let i = 0; i < 10; i++) logger.info(`line-${i}xx`);
    const files = await logger.getLogFiles();
    expect(files).toHaveLength(3);
    expect(files.every((f) => f.size <= 25)).toBe(true);
    const content = await logger.readLogFile();
    expect(content).toBe(
      '1|line-4xx\n1|line-5xx\n1|line-6xx\n1|line-7xx\n1|line-8xx\n1|line-9xx\n'
    );
  });

  it('writes a line bigger than maximumFileSize into its own file', async () => {
    const { logger } = await createLogger({ maximumFileSize: 5 });
    logger.info('this line is too long');
    logger.info('and this one too');
    const files = await logger.getLogFiles();
    expect(files).toHaveLength(2);
  });

  it('starts a new file when the day changes (dailyRolling)', async () => {
    jest.useFakeTimers({ now: new Date(2026, 8, 28, 23, 59, 0) });
    const { logger } = await createLogger({ flushInterval: 0 });
    logger.info('today');
    await logger.flush();
    jest.setSystemTime(new Date(2026, 8, 29, 0, 0, 1));
    logger.info('tomorrow');
    await logger.flush();
    const files = await logger.getLogFiles();
    expect(files.map((f) => f.name)).toEqual([
      '2026-09-28_23-59-00-000.log',
      '2026-09-29_00-00-01-000.log',
    ]);
  });

  it('resumes the latest file after reconfiguring and honours logPrefix', async () => {
    const storage = new MemoryStorage();
    const first = new Logger(storage);
    await first.configure({ captureConsole: false, formatter: plain, logPrefix: 'app-' });
    first.info('one');
    await first.flush();

    await storage.append('unrelated.txt', 'ignore me');
    const second = new Logger(storage);
    await second.configure({ captureConsole: false, formatter: plain, logPrefix: 'app-' });
    second.info('two');
    const files = await second.getLogFiles();
    expect(files).toHaveLength(1);
    expect(files[0]!.name.startsWith('app-')).toBe(true);
    expect(await second.readLogFile(files[0]!.name)).toBe('1|one\n1|two\n');
  });

  it('captures console calls and restores them', async () => {
    const original = { log: console.log, warn: console.warn };
    const log = jest.fn();
    const warn = jest.fn();
    console.log = log;
    console.warn = warn;
    try {
      const { logger } = await createLogger({ captureConsole: true });
      expect(logger.isConsoleCaptureEnabled()).toBe(true);
      console.log('user %s', 'ana', { id: 1 });
      console.warn('careful');
      expect(log).toHaveBeenCalledWith('user %s', 'ana', { id: 1 });
      logger.disableConsoleCapture();
      console.log('not captured');
      expect(console.log).toBe(log);
      expect(await logger.readLogFile()).toBe('1|user ana { id: 1 }\n2|careful\n');
    } finally {
      console.log = original.log;
      console.warn = original.warn;
    }
  });

  it('prefixes messages from tagged loggers', async () => {
    const { logger } = await createLogger();
    logger.createLogger('Auth').warn('token expired');
    expect(await logger.readLogFile()).toBe('2|[Auth] token expired\n');
  });

  it('deletes all log files', async () => {
    const { logger } = await createLogger();
    logger.info('something');
    expect(await logger.getLogFilePaths()).toHaveLength(1);
    await logger.deleteLogFiles();
    expect(await logger.getLogFilePaths()).toHaveLength(0);
    logger.info('again');
    expect(await logger.readLogFile()).toBe('1|again\n');
  });
});
