import {
  buildTextProjection,
  type BuildTextProjectionInput,
} from "../extraction/buildTextProjection.js";
import type { TextProjection } from "../types/TextProjection.js";

/**
 * TEXT-L2 — sole authorized factory for TextProjection.
 * Adapters and pipelines MUST go through this builder (not invent formats).
 */
export class TextProjectionBuilder {
  static build(input: BuildTextProjectionInput): TextProjection {
    return buildTextProjection(input);
  }
}

/** @deprecated Prefer TextProjectionBuilder.build — kept as thin alias. */
export { buildTextProjection };
