export interface CanonicalNumber {
  canonicalize(value: number): number; // IEEE754 canonical
}

export class DefaultCanonicalNumber implements CanonicalNumber {
  canonicalize(value: number): number {
    if (Number.isNaN(value)) {
      return NaN; // Normaliserar alla JS NaN till en standard NaN
    }
    if (value === 0 && 1 / value === -Infinity) {
      return 0; // -0 konverteras till +0
    }
    return value;
  }
}
