import type { FreezePolicy } from '../policy';
import type { Manifest } from '../types';
import { isRecord, hasExactKeys, type Rec } from '../json';

/** What every stage after C1 receives: the validated manifest, the validated policy and the raw observations. */
export interface StageContext {
  readonly manifest: Manifest;
  readonly policy: FreezePolicy;
  readonly observations: Rec;
}

export type Unwrapped = { readonly kind: 'absent' } | { readonly kind: 'malformed' } | { readonly kind: 'ok'; readonly payload: unknown };

/** An observation of a derivation record is `{ payload }`. Missing key / null / undefined payload = absent. */
export function unwrapPayload(observations: Rec, key: string): Unwrapped {
  const wrapper = observations[key];
  if (wrapper === undefined || wrapper === null) return { kind: 'absent' };
  if (!isRecord(wrapper) || !hasExactKeys(wrapper, ['payload'])) return { kind: 'malformed' };
  if (wrapper.payload === undefined || wrapper.payload === null) return { kind: 'absent' };
  return { kind: 'ok', payload: wrapper.payload };
}
