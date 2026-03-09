/**
 * Extract plain text from an NSMutableAttributedString streamtyped blob.
 *
 * The iMessage database stores message text in the `attributedBody` column
 * as a binary serialized NSMutableAttributedString. The `text` column is
 * empty for ~99.9% of messages.
 *
 * Binary format:
 *   ... NSString\x01[\x94|\x95]\x84\x01+ <length> <utf8 text> ...
 *
 * The byte after \x01 varies by macOS/iOS version (0x94 or 0x95).
 *
 * Length encoding:
 *   - byte < 0x80: single-byte length
 *   - 0x81: next 2 bytes are little-endian uint16
 *   - 0x82: next 3 bytes are little-endian uint24
 *   - 0x83: next 4 bytes are little-endian uint32
 */

// Match "NSString" + \x01 then skip one variable byte, then match \x84\x01+
const NS_STRING = Buffer.from("NSString");
const TAIL = Buffer.from([0x84, 0x01, 0x2b]); // \x84\x01+

function findMarker(blob: Buffer): number {
  let searchFrom = 0;
  while (true) {
    const idx = blob.indexOf(NS_STRING, searchFrom);
    if (idx === -1) return -1;
    // Check: NSString(8) + \x01(1) + variable(1) + \x84\x01\x2b(3) = 13 bytes total
    const tailStart = idx + 8 + 2; // skip "NSString" + 0x01 + variable_byte
    if (tailStart + 3 > blob.length) return -1;
    if (blob[idx + 8] === 0x01 && blob.subarray(tailStart, tailStart + 3).equals(TAIL)) {
      return tailStart + 3; // return offset right after the marker (at the length byte)
    }
    searchFrom = idx + 1;
  }
}

export function extractTextFromAttributedBody(blob: Buffer | null): string | null {
  if (!blob || blob.length === 0) return null;

  let offset = findMarker(blob);
  if (offset === -1) return null;
  if (offset >= blob.length) return null;

  const firstByte = blob[offset];
  let textLength: number;

  if (firstByte < 0x80) {
    textLength = firstByte;
    offset += 1;
  } else if (firstByte === 0x81) {
    if (offset + 3 > blob.length) return null;
    textLength = blob[offset + 1] | (blob[offset + 2] << 8);
    offset += 3;
  } else if (firstByte === 0x82) {
    if (offset + 4 > blob.length) return null;
    textLength = blob[offset + 1] | (blob[offset + 2] << 8) | (blob[offset + 3] << 16);
    offset += 4;
  } else if (firstByte === 0x83) {
    if (offset + 5 > blob.length) return null;
    textLength =
      blob[offset + 1] |
      (blob[offset + 2] << 8) |
      (blob[offset + 3] << 16) |
      ((blob[offset + 4] << 24) >>> 0);
    offset += 5;
  } else {
    return null;
  }

  if (textLength === 0) return null;
  if (offset + textLength > blob.length) return null;

  return blob.subarray(offset, offset + textLength).toString("utf-8");
}
