import { Logger } from './Logger';
import { createStorage } from './storage';

export { Logger } from './Logger';
export { defaultFormatter, formatArgs, inspect, logLevelNames } from './format';
export { MemoryStorage } from './storage/MemoryStorage';
export type { LogStorage } from './storage/LogStorage';
export {
  ExpoLogsError,
  LogLevel,
  type ConfigureOptions,
  type LogFileInfo,
  type LogFormatter,
  type SendByEmailOptions,
  type ShareOptions,
  type TaggedLogger,
} from './types';

/**
 * Shared logger instance. API-compatible with `react-native-file-logger`'s `FileLogger`,
 * implemented in TypeScript on top of expo-file-system (so it runs in Expo Go).
 */
export const FileLogger = new Logger(createStorage());

export default FileLogger;
