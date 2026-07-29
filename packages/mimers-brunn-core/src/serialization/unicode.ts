/**
 * UTF-16 lone-surrogate checks for RFC8785-safe string serialization.
 */
export function assertValidUnicodeString(value: string): void {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (Number.isNaN(next) || !(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError('[C-01] String contains an unpaired high surrogate.');
      }
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError('[C-01] String contains an unpaired low surrogate.');
    }
  }
}
