import { createHash } from 'crypto';

/**
 * Runtime projection canonicalizers.
 *
 * MAT-I05 / C-02: the `dg-` namespace belongs to mps-decision-governance. A canonical
 * version id must denote exactly one algorithm across the whole platform, so the runtime
 * may never register or resolve a governance-owned id — not even one that happens to
 * hash the same today.
 */
export type CanonicalizerId = 'runtime-projection-1' | 'RFC8785-STRICT-V1';

/** Namespaces owned by the decision authority layer. */
export const RESERVED_CANONICALIZER_NAMESPACES = Object.freeze(['dg-'] as const);

export interface CanonicalizerDefinition {
  algorithm: 'SHA256';
  serializer: 'JSON_STRINGIFY' | 'RFC8785_STRICT';
  status: 'ACTIVE' | 'DEPRECATED';
}

export class CanonicalizerRegistry {
  private static registry: Record<string, CanonicalizerDefinition> = {
    'runtime-projection-1': {
      algorithm: 'SHA256',
      serializer: 'JSON_STRINGIFY',
      status: 'ACTIVE'
    },
    'RFC8785-STRICT-V1': {
      algorithm: 'SHA256',
      serializer: 'RFC8785_STRICT',
      status: 'ACTIVE'
    }
  };

  static assertRuntimeOwnedNamespace(id: string): void {
    for (const reserved of RESERVED_CANONICALIZER_NAMESPACES) {
      if (id.startsWith(reserved)) {
        throw new Error(
          `CANONICALIZER_NAMESPACE_VIOLATION: '${id}' belongs to the decision authority layer ` +
            `and cannot be resolved by the runtime projection registry`
        );
      }
    }
  }

  static get(id: string): CanonicalizerDefinition {
    this.assertRuntimeOwnedNamespace(id);
    const def = this.registry[id];
    if (!def) {
      throw new Error(`UNKNOWN_CANONICALIZER`);
    }
    return def;
  }

  /**
   * Generates a canonical payload representation based on the canonicalizer's serializer
   */
  static canonicalize(id: string, payload: any): string {
    const def = this.get(id);
    
    // Sort keys recursively for basic canonicalization
    const deepSort = (obj: any): any => {
      if (typeof obj !== 'object' || obj === null) return obj;
      if (Array.isArray(obj)) return obj.map(deepSort);
      return Object.keys(obj).sort().reduce((acc, key) => {
        acc[key] = deepSort(obj[key]);
        return acc;
      }, {} as any);
    };
    
    if (def.serializer === 'JSON_STRINGIFY') {
      return JSON.stringify(deepSort(payload));
    }
    
    if (def.serializer === 'RFC8785_STRICT') {
      // Stub for actual RFC8785 strict serialization
      return JSON.stringify(deepSort(payload)) + '::RFC8785';
    }

    throw new Error(`Unsupported serializer: ${def.serializer}`);
  }

  /**
   * projection_hash = SHA256(canonicalizer_id || canonical_payload)
   */
  static generateIdentityHash(id: string, payload: any): string {
    const canonicalPayload = this.canonicalize(id, payload);
    const combined = `${id}||${canonicalPayload}`;
    return createHash('sha256').update(combined).digest('hex');
  }
}
