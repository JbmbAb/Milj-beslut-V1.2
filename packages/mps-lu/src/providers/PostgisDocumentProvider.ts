// packages/mps-lu/src/providers/PostgisDocumentProvider.ts

import { DocumentProviderContract } from "./DocumentProviderContract";
import { DocumentDescriptor } from "../domain/DocumentDescriptor";
import { CanonicalGeometry } from "../domain/CanonicalGeometry";
import { resolveMunicipality, type SpatialQueryClient } from "./MunicipalityResolution";
import { prisma } from "../../../../server/db/prisma";

/** The narrow slice of the database this provider needs, so the fail-closed paths are testable. */
export interface DocumentQueryClient extends SpatialQueryClient {
  documentRecord: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        subject: string | null;
        originalName: string;
        municipalityNormalized: string;
        diskName: string;
        decisionType: string | null;
        chunks: Array<{ chunkText: string }>;
      }>
    >;
  };
}

export class PostgisDocumentProvider implements DocumentProviderContract {
  private readonly client: DocumentQueryClient;

  constructor(client?: DocumentQueryClient) {
    this.client = client ?? (prisma as unknown as DocumentQueryClient);
  }

  getProviderName(): string {
    return "PostgisDocumentProvider";
  }

  public async fetchDocumentsForGeometry(geometry: CanonicalGeometry): Promise<DocumentDescriptor[]> {
    // 1. Resolve the municipality. DOCUMENT_PROVIDER_LOCATION_AUTHORITY_V1: a municipality
    //    identity must come from a successful resolution, and only from one.
    const resolution = await resolveMunicipality(this.client, geometry);

    if (resolution.status === "RESOLUTION_FAILED") {
      // A database failure is not "this geometry matches nothing". Swallowing it into an empty
      // result is what previously let a fabricated municipality select real documents.
      throw new Error(
        `RESOLUTION_FAILED: municipality resolution failed for the supplied geometry — ` +
          `${resolution.reason}. No document query is issued: documents selected under an ` +
          `unresolved jurisdiction would be indistinguishable downstream from correctly ` +
          `selected ones.`,
      );
    }

    if (resolution.status === "UNRESOLVED") {
      // A finding, not an error: the geometry resolved to no municipality. No document query.
      return [];
    }

    // 2. Query DocumentRecords for the RESOLVED municipality.
    const docs = await this.client.documentRecord.findMany({
      where: {
        municipalityNormalized: resolution.municipality,
      },
      include: {
        chunks: true,
      },
    });

    // 3. Map to observed descriptors. No document class is decided here.
    return docs.map((doc) => {
      const text = doc.chunks.map((c) => c.chunkText).join("\n\n");
      return {
        document_ref: doc.id,
        title: doc.subject || doc.originalName,
        metadata: {
          document_id: doc.id,
          municipalityNormalized: doc.municipalityNormalized,
          case_number: doc.diskName,
          text_content: text,
        },
        // OBSERVED, NON-AUTHORITATIVE. Absent when the source supplied none: that absence is
        // information. Substituting a default here is what previously turned a missing value
        // into an admitted legal class.
        ...(doc.decisionType ? { source_classification_label: doc.decisionType } : {}),
      };
    });
  }

}
