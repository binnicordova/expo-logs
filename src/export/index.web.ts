import type { LogStorage } from '../storage/LogStorage';
import {
  ExpoLogsError,
  type LogFileInfo,
  type SendByEmailOptions,
  type ShareOptions,
} from '../types';
import { buildMergedText, buildZip } from './archive';

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function toBlob(
  storage: LogStorage,
  files: LogFileInfo[],
  prefix: string,
  compress: boolean
): Promise<{ blob: Blob; name: string }> {
  if (compress) {
    const zip = await buildZip(storage, files);
    return {
      blob: new Blob([zip as BlobPart], { type: 'application/zip' }),
      name: `${prefix}logs-${timestamp()}.zip`,
    };
  }
  const text = await buildMergedText(storage, files);
  return {
    blob: new Blob([text], { type: 'text/plain' }),
    name: `${prefix}logs-${timestamp()}.log`,
  };
}

function download(blob: Blob, name: string) {
  if (typeof document === 'undefined') {
    throw new ExpoLogsError('ERR_NO_DOM', 'expo-logs: downloading logs requires a browser.');
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Browsers cannot attach files to a `mailto:` link, so on web the logs are downloaded
 * and the user's mail client is opened with recipients, subject and body pre-filled.
 */
export async function sendByEmail(
  storage: LogStorage,
  files: LogFileInfo[],
  prefix: string,
  options: SendByEmailOptions
): Promise<void> {
  if (files.length > 0) {
    const { blob, name } = await toBlob(storage, files, prefix, !!options.compressFiles);
    download(blob, name);
  }
  const to = options.to ? (Array.isArray(options.to) ? options.to : [options.to]) : [];
  const params: string[] = [];
  if (options.subject) params.push(`subject=${encodeURIComponent(options.subject)}`);
  if (options.body) params.push(`body=${encodeURIComponent(options.body)}`);
  const href = `mailto:${to.map(encodeURIComponent).join(',')}${params.length ? `?${params.join('&')}` : ''}`;
  if (typeof window !== 'undefined') window.location.href = href;
}

/** Uses the Web Share API with files when supported, otherwise downloads the logs. */
export async function share(
  storage: LogStorage,
  files: LogFileInfo[],
  prefix: string,
  options: ShareOptions
): Promise<void> {
  if (files.length === 0) {
    throw new ExpoLogsError('ERR_NO_LOGS', 'expo-logs: there are no log files to share yet.');
  }
  const { blob, name } = await toBlob(storage, files, prefix, !!options.compressFiles);
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (nav?.share && typeof globalThis.File === 'function') {
    const file = new globalThis.File([blob], name, { type: blob.type });
    if (nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: options.dialogTitle });
        return;
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') return;
      }
    }
  }
  download(blob, name);
}
