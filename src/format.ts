import type { LogFormatter } from './types';

export const logLevelNames = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;

/** Same output as react-native-file-logger: `2026-09-28T15:04:05.123Z [INFO]  message`. */
export const defaultFormatter: LogFormatter = (level, msg) => {
  const levelName = logLevelNames[level] ?? String(level);
  return `${new Date().toISOString()} [${levelName}]  ${msg}`;
};

const MAX_DEPTH = 4;
const MAX_ITEMS = 100;

function isError(value: unknown): value is Error {
  return (
    value instanceof Error ||
    (typeof value === 'object' &&
      value !== null &&
      typeof (value as Error).message === 'string' &&
      typeof (value as Error).name === 'string' &&
      'stack' in value)
  );
}

function formatError(error: Error): string {
  const head = `${error.name}: ${error.message}`;
  const stack = typeof error.stack === 'string' ? error.stack : '';
  if (!stack) return head;
  // V8 and Hermes stacks usually start with "Name: message".
  return stack.startsWith(head) || stack.startsWith(error.name) ? stack : `${head}\n${stack}`;
}

function inspectValue(value: unknown, depth: number, seen: WeakSet<object>, top: boolean): string {
  switch (typeof value) {
    case 'string':
      return top ? value : JSON.stringify(value);
    case 'number':
    case 'boolean':
      return String(value);
    case 'bigint':
      return `${value}n`;
    case 'undefined':
      return 'undefined';
    case 'symbol':
      return value.toString();
    case 'function':
      return `[Function: ${value.name || 'anonymous'}]`;
  }
  if (value === null) return 'null';
  const obj = value as object;
  if (isError(obj)) return formatError(obj);
  if (obj instanceof Date) return isNaN(obj.getTime()) ? 'Invalid Date' : obj.toISOString();
  if (obj instanceof RegExp) return obj.toString();
  if (seen.has(obj)) return '[Circular]';
  if (depth >= MAX_DEPTH) return Array.isArray(obj) ? '[Array]' : '[Object]';

  seen.add(obj);
  try {
    const next = (v: unknown) => inspectValue(v, depth + 1, seen, false);
    if (Array.isArray(obj)) {
      const items = obj.slice(0, MAX_ITEMS).map(next);
      if (obj.length > MAX_ITEMS) items.push(`... ${obj.length - MAX_ITEMS} more items`);
      return items.length ? `[ ${items.join(', ')} ]` : '[]';
    }
    if (obj instanceof Map) {
      const items = Array.from(obj.entries())
        .slice(0, MAX_ITEMS)
        .map(([k, v]) => `${next(k)} => ${next(v)}`);
      return `Map(${obj.size}) { ${items.join(', ')} }`;
    }
    if (obj instanceof Set) {
      const items = Array.from(obj.values()).slice(0, MAX_ITEMS).map(next);
      return `Set(${obj.size}) { ${items.join(', ')} }`;
    }
    const keys = Object.keys(obj);
    const items = keys.slice(0, MAX_ITEMS).map((key) => {
      const safeKey = /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
      let v: unknown;
      try {
        v = (obj as Record<string, unknown>)[key];
      } catch {
        v = '[Getter threw]';
      }
      return `${safeKey}: ${next(v)}`;
    });
    if (keys.length > MAX_ITEMS) items.push(`... ${keys.length - MAX_ITEMS} more keys`);
    const ctor = (obj as { constructor?: { name?: string } }).constructor?.name;
    const prefix = ctor && ctor !== 'Object' ? `${ctor} ` : '';
    return items.length ? `${prefix}{ ${items.join(', ')} }` : `${prefix}{}`;
  } finally {
    seen.delete(obj);
  }
}

/** Serializes any JS value into a readable single string (a small `util.inspect`). */
export function inspect(value: unknown): string {
  return inspectValue(value, 0, new WeakSet(), true);
}

/**
 * A dependency-free subset of Node's `util.format`: supports `%s %d %i %f %j %o %O %c %%`
 * and appends the remaining arguments separated by spaces.
 */
export function formatArgs(args: readonly unknown[]): string {
  if (args.length === 0) return '';
  const first = args[0];
  let rest = args.slice(1);
  let out: string;

  if (typeof first === 'string' && first.includes('%') && rest.length > 0) {
    let index = 0;
    out = first.replace(/%[sdifjoOc%]/g, (token) => {
      if (token === '%%') return '%';
      if (index >= rest.length) return token;
      const arg = rest[index++];
      switch (token) {
        case '%s':
          return typeof arg === 'string' ? arg : inspect(arg);
        case '%d':
        case '%i': {
          if (typeof arg === 'bigint') return `${arg}n`;
          const n = Number(arg);
          return String(token === '%i' ? Math.trunc(n) : n);
        }
        case '%f':
          return String(parseFloat(String(arg)));
        case '%j':
          try {
            return JSON.stringify(arg) ?? 'undefined';
          } catch {
            return '[Circular]';
          }
        case '%c':
          return '';
        default:
          return inspectValue(arg, 0, new WeakSet(), false);
      }
    });
    rest = rest.slice(index);
  } else {
    out = inspect(first);
  }

  for (const arg of rest) out += ' ' + inspect(arg);
  return out;
}

/** UTF-8 byte length without relying on TextEncoder. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}
