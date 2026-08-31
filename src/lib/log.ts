/**
 * Lightweight development logging.
 *
 * Deliberately console-only: no external logging services, no telemetry. User
 * annotations (notes, contact names) must never be passed to these functions —
 * log identifiers and counts instead.
 */

const isDev = import.meta.env?.DEV ?? false;

type Fields = Record<string, string | number | boolean | null | undefined>;

function format(scope: string, message: string, fields?: Fields): string {
  if (!fields) return `[${scope}] ${message}`;
  const rendered = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  return rendered ? `[${scope}] ${message} ${rendered}` : `[${scope}] ${message}`;
}

export interface Logger {
  debug(message: string, fields?: Fields): void;
  info(message: string, fields?: Fields): void;
  warn(message: string, fields?: Fields): void;
  error(message: string, fields?: Fields): void;
}

export function createLogger(scope: string): Logger {
  return {
    debug(message, fields) {
      if (isDev) console.debug(format(scope, message, fields));
    },
    info(message, fields) {
      if (isDev) console.info(format(scope, message, fields));
    },
    warn(message, fields) {
      console.warn(format(scope, message, fields));
    },
    error(message, fields) {
      console.error(format(scope, message, fields));
    },
  };
}
