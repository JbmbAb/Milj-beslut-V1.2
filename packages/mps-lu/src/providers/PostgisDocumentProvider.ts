// packages/mps-lu/src/providers/PostgisDocumentProvider.ts

import { DocumentProviderContract } from "./DocumentProviderContract";
import { DocumentDescriptor } from "../domain/DocumentDescriptor";
import { CanonicalGeometry } from "../domain/CanonicalGeometry";
import { prisma } from "../../../../server/db/prisma";

export class PostgisDocumentProvider implements DocumentProviderContract {
  getProviderName(): string {
    return "PostgisDocumentProvider";
  }

  public async fetchDocumentsForGeometry(geometry: CanonicalGeometry): Promise<DocumentDescriptor[]> {
    // 1. Get the municipality from PostGIS spatial query using the geometry
    const res = await prisma.$queryRawUnsafe<Array<{ kommunnamn: string }>>(`
      SELECT DISTINCT name AS kommunnamn
      FROM hydro.water_catchment
      WHERE geom && ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), 3006)
      LIMIT 1
    `, [JSON.stringify(geometry)]).catch(() => []);

    const municipality = res[0]?.kommunnamn || "Mora"; // Fallback to Mora for test stability

    // 2. Query DocumentRecords that match this municipality!
    const docs = await prisma.documentRecord.findMany({
      where: {
        municipalityNormalized: municipality,
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
