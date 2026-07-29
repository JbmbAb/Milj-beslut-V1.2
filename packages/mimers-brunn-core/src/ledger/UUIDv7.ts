import { randomBytes } from 'node:crypto';

let lastTimestamp = 0n;
let sequenceCounter = 0;

/** RFC 9562 UUIDv7 with monotonic counter within the same millisecond. */
export function generateUUIDv7(): string {
  const bytes = randomBytes(16);
  const wallClock = BigInt(Date.now());
  let timestamp = wallClock > lastTimestamp ? wallClock : lastTimestamp;

  if (timestamp === lastTimestamp) {
    sequenceCounter += 1;
    if (sequenceCounter > 0x0fff) {
      timestamp = lastTimestamp + 1n;
      lastTimestamp = timestamp;
      sequenceCounter = 0;
    }
  } else {
    lastTimestamp = timestamp;
    sequenceCounter = 0;
  }

  for (let i = 0; i < 6; i += 1) {
    bytes[i] = Number((timestamp >> BigInt((5 - i) * 8)) & 0xffn);
  }

  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  const seqBits = sequenceCounter & 0xfff;
  bytes[6] = (bytes[6]! & 0xf0) | ((seqBits >> 8) & 0x0f);
  bytes[7] = seqBits & 0xff;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Buffer.from(bytes).toString('hex');
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    hex.substring(12, 16),
    hex.substring(16, 20),
    hex.substring(20, 32),
  ].join('-');
}
