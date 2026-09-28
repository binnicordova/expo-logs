import { Directory, File, Paths } from 'expo-file-system';

import type { LogStorage } from '../storage/LogStorage';
import {
  ExpoLogsError,
  type LogFileInfo,
  type SendByEmailOptions,
  type ShareOptions,
} from '../types';
import { buildMergedText, buildZip } from './archive';

type MailComposerModule = typeof import('expo-mail-composer');
type SharingModule = typeof import('expo-sharing');

// Optional peer dependencies: Expo's Metro config allows optional requires inside try/catch,
// so apps that never share/email logs do not have to install these packages.
function loadMailComposer(): MailComposerModule | null {
  try {
    return require('expo-mail-composer');
  } catch {
    return null;
  }
}

function loadSharing(): SharingModule | null {
  try {
    return require('expo-sharing');
  } catch {
    return null;
  }
}

function exportDirectory(): Directory {
  const dir = new Directory(Paths.cache, 'expo-logs-export');
  if (dir.exists) dir.delete();
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function writeZip(storage: LogStorage, files: LogFileInfo[], prefix: string): Promise<File> {
  const file = new File(exportDirectory(), `${prefix}logs-${timestamp()}.zip`);
  file.create();
  await file.write(await buildZip(storage, files));
  return file;
}

async function writeMerged(
  storage: LogStorage,
  files: LogFileInfo[],
  prefix: string
): Promise<File> {
  const file = new File(exportDirectory(), `${prefix}logs-${timestamp()}.log`);
  file.create();
  await file.write(await buildMergedText(storage, files));
  return file;
}

export async function sendByEmail(
  storage: LogStorage,
  files: LogFileInfo[],
  prefix: string,
  options: SendByEmailOptions
): Promise<void> {
  const MailComposer = loadMailComposer();
  if (!MailComposer) {
    throw new ExpoLogsError(
      'ERR_MAIL_COMPOSER_MISSING',
      'expo-logs: install "expo-mail-composer" to send logs by email (npx expo install expo-mail-composer).'
    );
  }
  if (!(await MailComposer.isAvailableAsync())) {
    throw new ExpoLogsError(
      'ERR_MAIL_UNAVAILABLE',
      'expo-logs: no mail account is configured on this device. Use FileLogger.shareLogFiles() instead.'
    );
  }

  let attachments: string[] = files.map((f) => f.uri);
  if (options.compressFiles && files.length > 0) {
    attachments = [(await writeZip(storage, files, prefix)).uri];
  }

  const to = options.to;
  await MailComposer.composeAsync({
    recipients: to ? (Array.isArray(to) ? to : [to]) : undefined,
    subject: options.subject,
    body: options.body,
    attachments,
  });
}

export async function share(
  storage: LogStorage,
  files: LogFileInfo[],
  prefix: string,
  options: ShareOptions
): Promise<void> {
  const Sharing = loadSharing();
  if (!Sharing) {
    throw new ExpoLogsError(
      'ERR_SHARING_MISSING',
      'expo-logs: install "expo-sharing" to share logs (npx expo install expo-sharing).'
    );
  }
  if (files.length === 0) {
    throw new ExpoLogsError('ERR_NO_LOGS', 'expo-logs: there are no log files to share yet.');
  }
  if (!(await Sharing.isAvailableAsync())) {
    throw new ExpoLogsError('ERR_SHARING_UNAVAILABLE', 'expo-logs: sharing is not available.');
  }

  if (options.compressFiles) {
    const zip = await writeZip(storage, files, prefix);
    await Sharing.shareAsync(zip.uri, {
      mimeType: 'application/zip',
      UTI: 'public.zip-archive',
      dialogTitle: options.dialogTitle,
    });
    return;
  }

  const uri = files.length === 1 ? files[0]!.uri : (await writeMerged(storage, files, prefix)).uri;
  await Sharing.shareAsync(uri, {
    mimeType: 'text/plain',
    UTI: 'public.plain-text',
    dialogTitle: options.dialogTitle,
  });
}
