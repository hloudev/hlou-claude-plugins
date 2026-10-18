/*
 * Pixel size of a PNG, JPEG or WebP from its header — enough to check the
 * bundle's edge limits without decoding anything.
 */

/** `{ format, width, height }`, or null when the bytes are none of the three. */
export function imageSize(bytes) {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    b.length >= 24 &&
    b.readUInt32BE(0) === 0x89504e47 &&
    b.toString('ascii', 12, 16) === 'IHDR'
  ) {
    return { format: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) return jpegSize(b);
  if (
    b.length >= 30 &&
    b.toString('ascii', 0, 4) === 'RIFF' &&
    b.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return webpSize(b);
  }
  return null;
}

function jpegSize(b) {
  let at = 2;
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    const length = b.readUInt16BE(at + 2);
    /* SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC). */
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { format: 'jpeg', width: b.readUInt16BE(at + 7), height: b.readUInt16BE(at + 5) };
    }
    at += 2 + length;
  }
  return null;
}

function webpSize(b) {
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    return {
      format: 'webp',
      width: 1 + b.readUIntLE(24, 3),
      height: 1 + b.readUIntLE(27, 3),
    };
  }
  if (chunk === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { format: 'webp', width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  if (chunk === 'VP8 ') {
    return {
      format: 'webp',
      width: b.readUInt16LE(26) & 0x3fff,
      height: b.readUInt16LE(28) & 0x3fff,
    };
  }
  return null;
}
