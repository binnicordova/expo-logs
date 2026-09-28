# expo-logs

[![npm](https://img.shields.io/npm/v/expo-logs.svg)](https://www.npmjs.com/package/expo-logs)
[![license](https://img.shields.io/npm/l/expo-logs.svg)](./LICENSE)
![platforms](https://img.shields.io/badge/platforms-iOS%20%7C%20Android%20%7C%20Web-blue)
![Expo Go](https://img.shields.io/badge/Expo%20Go-compatible-000020)

A file logger for Expo apps, written in pure TypeScript.

`expo-logs` writes your app's logs to rotating files on the device, captures `console.*` output, and lets users share or email the logs to you. It has **no native code**: it's built on modules that already ship inside Expo Go (`expo-file-system`, `expo-sharing`, `expo-mail-composer`), so it:

- runs in **Expo Go**, with no development build or prebuild,
- can be added or upgraded through **expo-updates / EAS Update** (OTA), since it's plain JavaScript,
- works the same on **iOS, Android and Web**.

The API follows [`react-native-file-logger`](https://github.com/BeTomorrow/react-native-file-logger), so migrating is mostly an import change.

## Contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [API](#api)
- [How files are written](#how-files-are-written)
- [Platform notes](#platform-notes)
- [Migrating from react-native-file-logger](#migrating-from-react-native-file-logger)
- [Example app](#example-app)
- [Contributing](#contributing)

## Installation

Requires **Expo SDK 58** or newer.

```sh
npx expo install expo-logs expo-file-system
```

These are optional and only needed to send logs out of the device:

```sh
npx expo install expo-sharing expo-mail-composer
```

| Package              | Needed for                          | Required |
| -------------------- | ----------------------------------- | -------- |
| `expo-file-system`   | Writing log files on iOS / Android  | Yes      |
| `expo-sharing`       | `FileLogger.shareLogFiles()`        | Optional |
| `expo-mail-composer` | `FileLogger.sendLogFilesByEmail()`  | Optional |

All three are included in Expo Go. `.zip` export uses [fflate](https://github.com/101arrowz/fflate), a small pure-JS dependency.

## Quick start

Configure the logger once, as early as possible (for example in `index.ts` or your root `_layout.tsx`):

```ts
import { FileLogger, LogLevel } from 'expo-logs';

FileLogger.configure({
  logLevel: __DEV__ ? LogLevel.Debug : LogLevel.Info,
  captureConsole: true, // console.log/info/warn/error/debug also go to the file
  captureUnhandledErrors: true, // record uncaught JS errors
});
```

From then on, every `console.*` call is also written to the log file. You can log directly too:

```ts
FileLogger.info('User signed in', { id: user.id });
FileLogger.warn('Slow request: %s took %dms', url, 1840);
FileLogger.error(error); // Errors are written with their stack trace

const log = FileLogger.createLogger('Payments');
log.info('checkout started'); // "... [INFO]  [Payments] checkout started"
```

Let users send you their logs:

```ts
import { ExpoLogsError, FileLogger } from 'expo-logs';

async function reportProblem() {
  try {
    await FileLogger.sendLogFilesByEmail({
      to: 'support@example.com',
      subject: 'Bug report',
      body: 'Describe what happened:',
      compressFiles: true,
    });
  } catch (error) {
    // No mail account on the device (e.g. iOS Simulator): fall back to the share sheet.
    if (error instanceof ExpoLogsError && error.code === 'ERR_MAIL_UNAVAILABLE') {
      await FileLogger.shareLogFiles({ compressFiles: true });
    } else {
      throw error;
    }
  }
}
```

## Configuration

`FileLogger.configure(options?: ConfigureOptions): Promise<void>`

| Option                   | Type                                      | Default                          | Description                                                                                  |
| ------------------------ | ----------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------- |
| `logLevel`               | `LogLevel`                                | `LogLevel.Debug`                 | Minimum level written to the file. Console output is not affected.                           |
| `formatter`              | `(level: LogLevel, msg: string) => string` | `defaultFormatter`               | Builds each line. The default gives `2026-09-28T15:04:05.123Z [INFO]  message`.               |
| `captureConsole`         | `boolean`                                 | `true`                           | Mirror `console.debug/log/info/warn/error` into the file.                                    |
| `captureUnhandledErrors` | `boolean`                                 | `false`                          | Record uncaught errors (`ErrorUtils` on native; `error` / `unhandledrejection` on web).      |
| `dailyRolling`           | `boolean`                                 | `true`                           | Start a new file when the local date changes.                                                 |
| `maximumFileSize`        | `number` (bytes)                          | `1048576` (1 MB)                 | Start a new file when the current one would exceed this size. `0` disables.                  |
| `maximumNumberOfFiles`   | `number`                                  | `5`                              | Keep at most this many files, deleting the oldest. `0` disables.                              |
| `logsDirectory`          | `string`                                  | `Paths.cache/logs`               | Where to store the files: a `file://` URI or an absolute path. On web, a storage namespace.  |
| `logPrefix`              | `string`                                  | `''`                             | Prefix for file names, e.g. `'myapp-'` gives `myapp-2026-09-28_10-15-00-123.log`.              |
| `flushInterval`          | `number` (ms)                             | `500`                            | How long writes are batched before going to disk. `0` writes on every call.                  |

To keep logs somewhere the OS won't clean up, use the document directory:

```ts
import { Paths } from 'expo-file-system';

FileLogger.configure({ logsDirectory: `${Paths.document.uri}logs` });
```

`configure()` can be called again at any time, for example to change the level or the directory. Pending lines are written to the previous configuration first.

## API

All methods are on the shared `FileLogger` instance (also the default export).

### Writing

| Method                                  | Description                                                                        |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| `debug(...args)` / `info(...args)`      | Log at `Debug` / `Info`. Arguments are formatted like `console.log`, `%s %d %i %f %j %o %O` included. |
| `warn(...args)` / `error(...args)`      | Log at `Warning` / `Error`.                                                        |
| `write(level, msg)`                     | Append a pre-formatted message at the given level.                                 |
| `createLogger(tag)`                     | Return `{ debug, info, warn, error }` that prefix every message with `[tag]`.      |
| `flush(): Promise<void>`                | Write buffered lines to disk now. Also runs automatically when the app goes to the background. |

### Level and console capture

| Method                                   | Description                                    |
| ---------------------------------------- | ---------------------------------------------- |
| `setLogLevel(level)` / `getLogLevel()`   | Change or read the minimum level.              |
| `enableConsoleCapture()`                 | Start mirroring `console.*` into the file.     |
| `disableConsoleCapture()`                | Restore the original `console` methods.        |
| `isConsoleCaptureEnabled()`              | Whether capture is on.                         |
| `isConfigured()`                         | Whether `configure()` has finished.            |

### Files

| Method                                              | Description                                                                                  |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `getLogFiles(): Promise<LogFileInfo[]>`             | `{ name, uri, size, modificationTime }` for each log file, oldest first.                     |
| `getLogFilePaths(): Promise<string[]>`              | Just the URIs (`file://…` on native), oldest first.                                          |
| `readLogFile(nameOrUri?): Promise<string>`          | Contents of one file, or of all files merged when called without an argument.                |
| `deleteLogFiles(): Promise<void>`                   | Delete every log file.                                                                        |
| `shareLogFiles(options?): Promise<void>`            | Open the share sheet. Several files are merged into one `.log`, or zipped with `compressFiles: true`. |
| `sendLogFilesByEmail(options?): Promise<void>`      | Open the mail composer with the logs attached. Options: `to`, `subject`, `body`, `compressFiles`. |

### Errors

Methods reject with an `ExpoLogsError` whose `code` is one of:

| Code                         | When                                                                    |
| ---------------------------- | ----------------------------------------------------------------------- |
| `ERR_MAIL_UNAVAILABLE`       | No mail account is set up on the device (always on the iOS Simulator). |
| `ERR_MAIL_COMPOSER_MISSING`  | `expo-mail-composer` isn't installed.                                   |
| `ERR_SHARING_MISSING`        | `expo-sharing` isn't installed.                                         |
| `ERR_SHARING_UNAVAILABLE`    | The platform can't share files.                                         |
| `ERR_NO_LOGS`                | There's nothing to share yet.                                           |

### Other exports

- `LogLevel`: `Debug = 0`, `Info = 1`, `Warning = 2`, `Error = 3`.
- `defaultFormatter`, `logLevelNames`, `formatArgs(args)` and `inspect(value)`: the pieces the default output is built from, for your own formatter.
- `Logger` and `MemoryStorage`: create independent logger instances, or test code that logs without touching the file system:

  ```ts
  import { Logger, MemoryStorage } from 'expo-logs';

  const logger = new Logger(new MemoryStorage());
  await logger.configure({ captureConsole: false });
  ```

## How files are written

- **Buffered.** `write()` is synchronous and never blocks rendering. Lines are batched and appended to disk every `flushInterval` ms, straight away once 200 lines are waiting, and whenever the app leaves the foreground.
- **Nothing is lost at startup.** Up to 1,000 lines logged before `configure()` resolves are kept in memory and written once it does.
- **Rotation.** File names look like `<prefix>YYYY-MM-DD_HH-mm-ss-SSS.log`, so they sort by date. A new file starts on a new day (`dailyRolling`) or when the next line would go past `maximumFileSize`. After a rotation, the oldest files are deleted so no more than `maximumNumberOfFiles` remain.
- **Restarts.** On launch, the logger keeps appending to the newest file if it's from today and still under the size limit.
- **Safe.** Errors inside the logger are reported with the original `console.warn` and never thrown into your code, and the logger never logs its own output again.

## Platform notes

**iOS and Android** use the `expo-file-system` `File` / `Directory` API. By default logs go to `Paths.cache/logs`, the same place `react-native-file-logger` uses. The OS may clear the cache when storage runs low; set `logsDirectory` under `Paths.document` if logs must survive that.

**iOS Simulator** has no Mail app, so `sendLogFilesByEmail()` rejects with `ERR_MAIL_UNAVAILABLE`. Use `shareLogFiles()` there, or catch the error as shown in [Quick start](#quick-start).

**Web** stores each log file as a `localStorage` entry (in memory if `localStorage` isn't available, e.g. during SSR). Browsers allow about 5 MB per origin, so if space runs out the oldest files are dropped. Consider a smaller `maximumFileSize` on web. `shareLogFiles()` uses the Web Share API when the browser can share files, and downloads the file otherwise. Browsers can't attach files to email, so `sendLogFilesByEmail()` downloads the logs and opens a `mailto:` link with the recipients, subject and body filled in.

**expo-updates / EAS Update.** `expo-logs` has no native code, so it doesn't change your runtime version or fingerprint. You can add it to an app that is already in the stores and ship it with `eas update`, as long as the store build already includes `expo-file-system` (and `expo-sharing` / `expo-mail-composer` if you use them).

## Migrating from react-native-file-logger

```diff
- import { FileLogger, LogLevel } from 'react-native-file-logger';
+ import { FileLogger, LogLevel } from 'expo-logs';
```

Then remove the old package and rebuild once, since you're dropping a native dependency. The differences are:

- `getLogFilePaths()` returns `file://` URIs, which is what `expo-file-system` and `expo-sharing` expect, instead of bare paths.
- `debug/info/warn/error` take any number of arguments of any type, like `console.log`, instead of a single string.
- New: `shareLogFiles()`, `getLogFiles()`, `readLogFile()`, `flush()`, `createLogger()`, `captureUnhandledErrors` and web support.

## Example app

The [`example`](./example) folder has an Expo Go app with buttons for every feature. It uses small rotation limits so you can watch files rotate.

```sh
bun install
cd example
bun install
bun run ios       # opens the iOS Simulator in Expo Go
bun run android   # opens the connected Android device / emulator in Expo Go
bun run web
```

The example's Metro config resolves `expo-logs` to `../src`, so changes to the library reload straight away without a build.

## Contributing

```sh
bun install
bun run typecheck
bun run lint
CI=1 bun run test
bun run build      # compiles src/ to build/
```

To publish:

```sh
npm login
npm publish        # prepublishOnly runs clean, tests, lint and the build
```

## License

MIT © [BinniCordova](https://github.com/binnicordova)
