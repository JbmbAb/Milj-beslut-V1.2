import { DocumentProviderContract } from "../../mps-lu/src/providers/DocumentProviderContract";
import { RelevantDocument } from "../../mps-lu/src/domain/RelevantDocument";
import { CanonicalGeometry } from "../../mps-lu/src/domain/CanonicalGeometry";

export class MockDocumentProvider implements DocumentProviderContract {
  public async fetchDocumentsForGeometry(geometry: CanonicalGeometry): Promise<RelevantDocument[]> {
    // This is a mock adapter. In a real scenario, this would query Lantmäteriet, Naturvårdsverket, or VISS
    // using the geometry coordinates to find intersecting legally binding documents.
    
    // F4B-0A — conforms to the frozen RelevantDocument contract: descriptive attributes only.
    // The previous `summary` fields carried legal characterisations ("beslut gällande
    // strandskyddsdispens", "föreläggande gällande PFAS-sanering"). Those are claims about what
    // the documents MEAN and belong in a verified DocumentFact with provenance and a source
    // span — not in free-form document metadata.
    return [
      {
        title: "Tidigare dom (MÖD 2018:14)",
        type: "decision",
        metadata: {
          court: "Mark- och miljööverdomstolen",
          document_date: "2018-05-12"
        }
      },
      {
        title: "Föreläggande om sanering",
        type: "injunction",
        metadata: {
          authority: "Länsstyrelsen",
          document_date: "2021-11-03"
        }
      }
    ];
  }

  public getProviderName(): string {
    return "MockDocumentProvider";
  }
}
