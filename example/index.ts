import { registerRootComponent } from 'expo';
import { FileLogger, LogLevel } from 'expo-logs';

import App from './App';

// Configure as early as possible so startup logs are captured too.
FileLogger.configure({
  logLevel: LogLevel.Debug,
  captureConsole: true,
  captureUnhandledErrors: true,
  logPrefix: 'example-',
  // Small limits so rotation is easy to see in the demo.
  maximumFileSize: 8 * 1024,
  maximumNumberOfFiles: 3,
}).then(() => console.info('expo-logs configured'));

registerRootComponent(App);
