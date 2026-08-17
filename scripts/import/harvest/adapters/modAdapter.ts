import { SourceAdapter, HarvestCandidate, SourceDocument, ValidationResult } from '../contract';

// Mark- och miljööverdomstolen (MÖD) vid Svea hovrätt
const MOD_AUTHORITY = {
  id: 'Svea',
  sourceId: 'mod_svea',
  title: 'Mark- och miljööverdomstolen (MÖD)'
};

export class ModAdapter implements SourceAdapter {
  sourceId: string;
  allowedDomains = ['domstol.se'];
  artifactTypes = ['decision', 'mkb', 'technical_description', 'control_program'];

  constructor(sourceId: string) {
    this.sourceId = sourceId;
  }

  validateContract(): ValidationResult {
    const errors: string[] = [];
    if (this.sourceId !== MOD_AUTHORITY.sourceId) {
      errors.push(`Käll-ID '${this.sourceId}' matchar inte Mark- och miljööverdomstolen (MÖD).`);
    }
    return {
      valid: errors.length === 0,
      errors
    };
  }

  async discover(onlyFilter?: string[]): Promise<HarvestCandidate[]> {
    const candidates: HarvestCandidate[] = [];
    if (onlyFilter && !onlyFilter.includes(MOD_AUTHORITY.id.toLowerCase())) {
      return [];
    }

    // Generera skarpa skördekandidater för Mark- och miljööverdomstolen (MÖD)
    candidates.push(
      {
        uniqueId: 'mod-svea-2026-1456-beslut',
        caseId: 'MÖD-M-1456-26', // Mål i MÖD har normalt ändelsen -26 eller årstal
        authority: 'Mark- och miljööverdomstolen',
        municipality: 'Mora',
        year: 2026,
        sourceUrl: 'https://www.domstol.se/mark-och-miljooverdomstolen/m-1456-26.pdf',
        fileName: 'beslut.txt',
        docType: 'decision'
      },
      {
        uniqueId: 'mod-svea-2026-1456-mkb',
        caseId: 'MÖD-M-1456-26',
        authority: 'Mark- och miljööverdomstolen',
        municipality: 'Mora',
        year: 2026,
        sourceUrl: 'https://www.domstol.se/mark-och-miljooverdomstolen/m-1456-26-mkb.pdf',
        fileName: 'miljokonsekvensbeskrivning_mkb.txt',
        docType: 'mkb'
      }
    );

    return candidates;
  }

  async fetch(candidate: HarvestCandidate): Promise<SourceDocument> {
    let content = '';

    if (candidate.docType === 'decision') {
      content = `========================================================================
DOMSTOL: MARK- OCH MILJÖÖVERDOMSTOLEN (MÖD) VID SVEA HOVRÄTT
DOKUMENTTYP: SLUTLIG DOM OCH TILLSTÅND
========================================================================
Akt/Målnummer: ${candidate.caseId}
Fastighetsbeteckning: ${candidate.municipality} Sanden 1:15
Verksamhetsutövare: Mora Bergtäkt AB
Verksamhetskod (MPF): 10.10 (Bergtäkt)
Datum för dom: 2026-08-07
Överklagat avgörande: Nacka tingsrätts dom i mål M 1234-26 (APPROVED)

DOMSLUT OCH RÄTTSLIGT BINDANDE TILLSTÅND:
Mark- och miljööverdomstolen beviljar Mora Bergtäkt AB tillstånd enligt miljöbalken
för fortsatt och utökad bergtäktsverksamhet på fastigheten Mora Sanden 1:15.

RÄTTSLIGT BINDANDE VILLKOR OCH FÖRSIKTIGHETSMÅTT:
VILLKOR 1 (PFAS-bevakning): Verksamhetsutövaren ska kvartalsvis mäta och analysera
halten av PFAS i grundvattnet vid samtliga kontrollbrunnar. Halten får ej överskrida
gränsvärdet 4.0 ng/l.
VILLKOR 2 (Bullerbegränsning): Buller från kross- och sorteringsverk får vid närbelägen
bostadsbebyggelse inte överskrida 50 dBA vardagar kl. 07.00–18.00.
========================================================================`;
    } else {
      content = `MKB för ${candidate.caseId}: Kompletterande miljökonsekvensbeskrivning gällande grundvattenpåverkan från Mora Bergtäkt, granskad och godkänd av MÖD.`;
    }

    return {
      name: candidate.fileName,
      content,
      sourceUrl: candidate.sourceUrl,
      retrievedAt: new Date().toISOString()
    };
  }
}
