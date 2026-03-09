// macOS Cocoa epoch: 2001-01-01 00:00:00 UTC
// Offset from Unix epoch (1970-01-01) to Cocoa epoch in milliseconds
const COCOA_EPOCH_OFFSET_MS = 978307200000;

/**
 * Convert a macOS Cocoa nanosecond timestamp to Unix milliseconds.
 * chat.db stores timestamps as nanoseconds since 2001-01-01.
 */
export function cocoaNsToUnixMs(cocoaNs: number | null | undefined): number | null {
  if (!cocoaNs || cocoaNs === 0) return null;
  return Math.floor(cocoaNs / 1_000_000) + COCOA_EPOCH_OFFSET_MS;
}

/**
 * Convert Unix milliseconds to macOS Cocoa nanoseconds.
 */
export function unixMsToCocoaNs(unixMs: number): number {
  return (unixMs - COCOA_EPOCH_OFFSET_MS) * 1_000_000;
}
