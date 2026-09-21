/**
 * Base64, hand-rolled, because the kernel has no DOM.
 *
 * `btoa` is a window global and `Buffer` is a Node one; the kernel is allowed
 * neither -- `verify-os-boundary.mjs` exists to keep it that way, and a kernel
 * that reaches for a browser global to file a file is a kernel that cannot be
 * tested outside a browser. The alphabet is fixed by RFC 4648 and thirty lines
 * of table lookup is a smaller dependency than either.
 *
 * This is a *projection*, not a format: the VFS stores text, a PDF is bytes, and
 * these two functions are the whole of the translation between them. Nothing
 * outside `vfs.writeBinary` and whatever eventually reads one back should need
 * them.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Reverse table, built once. `-1` marks a character that is not base64. */
const INVERSE = ((): Int8Array => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i += 1) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

/**
 * Bytes to base64, padded.
 *
 * Built in 3-byte groups because that is the unit base64 is defined over: three
 * bytes become four characters with nothing left over, and the two remainder
 * cases at the end are the only places padding appears.
 */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  const whole = bytes.length - (bytes.length % 3);

  for (let i = 0; i < whole; i += 3) {
    const word = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      ALPHABET[(word >> 18) & 63] +
      ALPHABET[(word >> 12) & 63] +
      ALPHABET[(word >> 6) & 63] +
      ALPHABET[word & 63];
  }

  const rest = bytes.length - whole;
  if (rest === 1) {
    const word = bytes[whole] << 16;
    out += `${ALPHABET[(word >> 18) & 63]}${ALPHABET[(word >> 12) & 63]}==`;
  } else if (rest === 2) {
    const word = (bytes[whole] << 16) | (bytes[whole + 1] << 8);
    out += `${ALPHABET[(word >> 18) & 63]}${ALPHABET[(word >> 12) & 63]}${ALPHABET[(word >> 6) & 63]}=`;
  }
  return out;
}

/**
 * Base64 back to bytes.
 *
 * Unknown characters are skipped rather than rejected, which is what makes this
 * tolerant of a projection that picked up a line break on its way through
 * storage. The length is computed from the padding rather than from the string,
 * so a stray newline cannot shorten the file.
 */
export function fromBase64(text: string): Uint8Array {
  const clean: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code > 127) continue;
    const value = INVERSE[code];
    if (value >= 0) clean.push(value);
  }

  // Four base64 characters carry three bytes; a trailing group of 2 or 3 carries
  // 1 or 2. Anything else is a truncated string, and the floor is the honest
  // reading of it.
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let out = 0;
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const word = (clean[i] << 18) | (clean[i + 1] << 12) | ((clean[i + 2] ?? 0) << 6) | (clean[i + 3] ?? 0);
    if (out < bytes.length) bytes[out++] = (word >> 16) & 255;
    if (out < bytes.length) bytes[out++] = (word >> 8) & 255;
    if (out < bytes.length) bytes[out++] = word & 255;
  }
  return bytes;
}
