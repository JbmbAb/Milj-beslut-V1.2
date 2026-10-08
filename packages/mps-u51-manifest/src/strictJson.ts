/**
 * C0 strict byte intake (contract 4): reject a BOM, invalid UTF-8, a duplicate object key, trailing
 * non-whitespace and anything that is not JSON. JSON.parse is NOT used: it accepts duplicate keys (last wins)
 * and so would let two different byte strings mean the same manifest.
 *
 * Objects are created without a prototype so that a key such as "__proto__" is an ordinary property.
 */

export type StrictParse = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly problem: string };

const MAX_DEPTH = 64;

class Failure extends Error {}

const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

function fail(problem: string): never {
  throw new Failure(problem);
}

class Parser {
  private pos = 0;
  constructor(private readonly text: string) {}

  parseDocument(): unknown {
    this.skipWs();
    const value = this.parseValue(0);
    this.skipWs();
    if (this.pos !== this.text.length) fail('trailing content after the JSON value');
    return value;
  }

  private skipWs(): void {
    while (this.pos < this.text.length) {
      const c = this.text.charCodeAt(this.pos);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) this.pos += 1;
      else break;
    }
  }

  private parseValue(depth: number): unknown {
    if (depth > MAX_DEPTH) fail('nesting too deep');
    const ch = this.text[this.pos];
    if (ch === '{') return this.parseObject(depth);
    if (ch === '[') return this.parseArray(depth);
    if (ch === '"') return this.parseString();
    if (this.text.startsWith('true', this.pos)) {
      this.pos += 4;
      return true;
    }
    if (this.text.startsWith('false', this.pos)) {
      this.pos += 5;
      return false;
    }
    if (this.text.startsWith('null', this.pos)) {
      this.pos += 4;
      return null;
    }
    return this.parseNumber();
  }

  private parseNumber(): number {
    NUMBER.lastIndex = this.pos;
    const m = NUMBER.exec(this.text);
    if (m === null) fail('not a JSON value');
    this.pos += m[0].length;
    const n = Number(m[0]);
    if (!Number.isFinite(n)) fail('number out of range');
    return n;
  }

  private parseObject(depth: number): unknown {
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    this.pos += 1;
    this.skipWs();
    if (this.text[this.pos] === '}') {
      this.pos += 1;
      return out;
    }
    for (;;) {
      this.skipWs();
      if (this.text[this.pos] !== '"') fail('object key expected');
      const key = this.parseString();
      if (Object.prototype.hasOwnProperty.call(out, key)) fail('duplicate object key');
      this.skipWs();
      if (this.text[this.pos] !== ':') fail('colon expected');
      this.pos += 1;
      this.skipWs();
      out[key] = this.parseValue(depth + 1);
      this.skipWs();
      const next = this.text[this.pos];
      this.pos += 1;
      if (next === '}') return out;
      if (next !== ',') fail('comma or closing brace expected');
    }
  }

  private parseArray(depth: number): unknown {
    const out: unknown[] = [];
    this.pos += 1;
    this.skipWs();
    if (this.text[this.pos] === ']') {
      this.pos += 1;
      return out;
    }
    for (;;) {
      this.skipWs();
      out.push(this.parseValue(depth + 1));
      this.skipWs();
      const next = this.text[this.pos];
      this.pos += 1;
      if (next === ']') return out;
      if (next !== ',') fail('comma or closing bracket expected');
    }
  }

  private parseString(): string {
    this.pos += 1; // opening quote
    let out = '';
    for (;;) {
      if (this.pos >= this.text.length) fail('unterminated string');
      const c = this.text.charCodeAt(this.pos);
      if (c === 0x22) {
        this.pos += 1;
        return out;
      }
      if (c < 0x20) fail('raw control character in string');
      if (c !== 0x5c) {
        out += this.text[this.pos];
        this.pos += 1;
        continue;
      }
      const esc = this.text[this.pos + 1];
      this.pos += 2;
      switch (esc) {
        case '"':
          out += '"';
          break;
        case '\\':
          out += '\\';
          break;
        case '/':
          out += '/';
          break;
        case 'b':
          out += '\b';
          break;
        case 'f':
          out += '\f';
          break;
        case 'n':
          out += '\n';
          break;
        case 'r':
          out += '\r';
          break;
        case 't':
          out += '\t';
          break;
        case 'u': {
          const unit = this.readHex4();
          if (unit >= 0xd800 && unit <= 0xdbff) {
            if (this.text[this.pos] !== '\\' || this.text[this.pos + 1] !== 'u') fail('lone surrogate escape');
            this.pos += 2;
            const low = this.readHex4();
            if (low < 0xdc00 || low > 0xdfff) fail('lone surrogate escape');
            out += String.fromCharCode(unit, low);
          } else if (unit >= 0xdc00 && unit <= 0xdfff) {
            fail('lone surrogate escape');
          } else {
            out += String.fromCharCode(unit);
          }
          break;
        }
        default:
          fail('invalid escape');
      }
    }
  }

  private readHex4(): number {
    const hex = this.text.slice(this.pos, this.pos + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('invalid unicode escape');
    this.pos += 4;
    return parseInt(hex, 16);
  }
}

/** A byte array of any realm (a jsdom test environment has its own Uint8Array, so instanceof is not enough). */
export const isByteArray = (v: unknown): v is Uint8Array => ArrayBuffer.isView(v) && Object.prototype.toString.call(v) === '[object Uint8Array]';

export function parseStrictJsonBytes(bytes: unknown): StrictParse {
  if (!isByteArray(bytes)) return { ok: false, problem: 'manifest bytes are not a byte array' };
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { ok: false, problem: 'byte order mark' };
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return { ok: false, problem: 'invalid UTF-8' };
  }
  try {
    return { ok: true, value: new Parser(text).parseDocument() };
  } catch (error) {
    if (error instanceof Failure) return { ok: false, problem: error.message };
    throw error;
  }
}
