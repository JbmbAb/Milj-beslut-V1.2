import { CanonicalDeserializer } from '../contracts/CanonicalDeserializer.js';
import { CanonicalPipeline } from '@miljobeslut/mps-canonical';

export class DefaultCanonicalDeserializer implements CanonicalDeserializer {
  constructor(private readonly pipeline: CanonicalPipeline) {}

  deserialize<T>(bytes: Uint8Array): Readonly<T> {
    throw new Error('Not implemented');
  }
}