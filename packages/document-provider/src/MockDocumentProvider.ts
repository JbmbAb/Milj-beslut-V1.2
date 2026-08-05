import { DocumentProviderContract } from "../../mps-lu/src/providers/DocumentProviderContract";
import { RelevantDocument } from "../../mps-lu/src/domain/RelevantDocument";
import { CanonicalGeometry } from "../../mps-lu/src/domain/CanonicalGeometry";

export class MockDocumentProvider implements DocumentProviderContract {
  public async fetchDocumentsForGeometry(geometry: CanonicalGeometry): Promise<RelevantDocument[]> {
    // This is a mock adapter. In a real scenario, this would query Lantmäteriet, Naturvårdsverket, or VISS
    // using the geometry coordinates to find intersecting legally binding documents.
    
    return [
      {
        title: "Tidigare dom (MÖD 2018:14)",
        type: "decision",
        metadata: {
          summary: "Ett tidigare beslut gällande strandskyddsdispens inom 500m.",
          court: "Mark- och miljööverdomstolen",
          date: "2018-05-12"
        }
      },
      {
        title: "Föreläggande om sanering",
        type: "injunction",
        metadata: {
          summary: "Tidigare föreläggande gällande PFAS-sanering i angränsande vattendrag.",
          authority: "Länsstyrelsen",
          date: "2021-11-03"
        }
      }
    ];
  }

  public getProviderName(): string {
    return "MockDocumentProvider";
  }
}
