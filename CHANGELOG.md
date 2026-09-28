# Changelog

## 0.1.0 — 2026-09-28

Initial release.

- `FileLogger` with an API based on `react-native-file-logger`, written in pure TypeScript and compatible with Expo Go and expo-updates.
- Log files rotate by day and by size, and the number of files kept can be capped.
- `console.*` capture, plus optional capture of unhandled errors.
- Share logs with `expo-sharing`, or email them with `expo-mail-composer`. Both are optional, and logs can be sent as a `.zip`.
- Web support, backed by `localStorage`.
- Tagged loggers, `readLogFile()`, `getLogFiles()` and `flush()`.
