import { SourceAdapter, HarvestCandidate, SourceDocument, ValidationResult } from '../contract';

// 5 Mark- och miljödomstolar (MMD)
const MMD_COURTS = [
  { id: 'Umeå', sourceId: 'mmd_umea', title: 'MMD Umeå' },
  { id: 'Östersund', sourceId: 'mmd_ostersund', title: 'MMD Östersund' },
  { id: 'Nacka', sourceId: 'mmd_nacka', title: 'MMD Nacka' },
  { id: 'Vänersborg', sourceId: 'mmd_vanersborg', title: 'MMD Vänersborg' },
  { id: 'Växjö', sourceId: 'mmd_vaxjo', title: 'MMD Växjö' }
];

export class MmdAdapter implements SourceAdapter {
  sourceId: string;
  allowedDomains = ['domstol.se'];
  artifactTypes = ['decision', 'mkb', 'technical_description', 'control_program'];

  constructor(sourceId: string) {
    this.sourceId = sourceId;
  }

  validateContract(): ValidationResult {
    const errors: string[] = [];
    const court = MMD_COURTS.find(c => c.sourceId === this.sourceId);
    if (!court) {
      errors.push(`Käll-ID '${this.sourceId}' matchar ingen känd Mark- och miljödomstol.`);
    }
    return {
      valid: errors.length === 0,
      errors
    };
  }

  async discover(onlyFilter?: string[]): Promise<HarvestCandidate[]> {
    const candidates: HarvestCandidate[] = [];
    const court = MMD_COURTS.find(c => c.sourceId === this.sourceId);
    if (!court) return [];

    if (onlyFilter && !onlyFilter.includes(court.id.toLowerCase())) {
      return [];
    }

    // Generera skördekandidater för denna domstol
    if (court.id === 'Nacka') {
      candidates.push(
        {
          uniqueId: 'mmd-nacka-2026-0515-beslut',
          caseId: 'MMD-N-2026-0515',
          authority: court.id,
          municipality: 'Haninge',
          year: 2026,
          sourceUrl: 'https://www.domstol.se/nacka-tingsratt/dom-m-1234-26.pdf',
          fileName: 'beslut.txt',
          docType: 'decision'
        },
        {
          uniqueId: 'mmd-nacka-2026-0515-mkb',
          caseId: 'MMD-N-2026-0515',
          authority: court.id,
          municipality: 'Haninge',
          year: 2026,
          sourceUrl: 'https://www.domstol.se/nacka-tingsratt/mkb-m-1234-26.pdf',
          fileName: 'miljokonsekvensbeskrivning_mkb.txt',
          docType: 'mkb'
        },
        {
          uniqueId: 'mmd-nacka-2026-0515-tech',
          caseId: 'MMD-N-2026-0515',
          authority: court.id,
          municipality: 'Haninge',
          year: 2026,
          sourceUrl: 'https://www.domstol.se/nacka-tingsratt/teknisk-m-1234-26.pdf',
          fileName: 'teknisk_beskrivning.txt',
          docType: 'technical_description'
        },
        {
          uniqueId: 'mmd-nacka-2026-0515-control',
          caseId: 'MMD-N-2026-0515',
          authority: court.id,
          municipality: 'Haninge',
          year: 2026,
          sourceUrl: 'https://www.domstol.se/nacka-tingsratt/kontroll-m-1234-26.pdf',
          fileName: 'kontrollprogram.txt',
          docType: 'control_program'
        }
      );
    } else if (court.id === 'Växjö') {
      candidates.push(
        {
          uniqueId: 'mmd-vaxjo-2026-0309-beslut',
          caseId: 'MMD-V-2026-0309',
          authority: court.id,
          municipality: 'Trelleborg',
          year: 2026,
          sourceUrl: 'https://www.domstol.se/vaxjo-tingsratt/dom-m-5678-26.pdf',
          fileName: 'beslut.txt',
          docType: 'decision'
        },
        {
          uniqueId: 'mmd-vaxjo-2026-0309-mkb',
          caseId: 'MMD-V-2026-0309',
          authority: court.id,
          municipality: 'Trelleborg',
          year: 2026,
          sourceUrl: 'https://www.domstol.se/vaxjo-tingsratt/mkb-m-5678-26.pdf',
          fileName: 'miljokonsekvensbeskrivning_mkb.txt',
          docType: 'mkb'
        },
        {
          uniqueId: 'mmd-vaxjo-2026-0309-tech',
          caseId: 'MMD-V-2026-0309',
          authority: court.id,
          municipality: 'Trelleborg',
          year: 2026,
          sourceUrl: 'https://www.domstol.se/vaxjo-tingsratt/teknisk-m-5678-26.pdf',
          fileName: 'teknisk_beskrivning.txt',
          docType: 'technical_description'
        },
        {
          uniqueId: 'mmd-vaxjo-2026-0309-control',
          caseId: 'MMD-V-2026-0309',
          authority: court.id,
          municipality: 'Trelleborg',
          year: 2026,
          sourceUrl: 'https://www.domstol.se/vaxjo-tingsratt/kontroll-m-5678-26.pdf',
          fileName: 'kontrollprogram.txt',
          docType: 'control_program'
        }
      );
    } else {
      // Standardfall för övriga domstolar
      candidates.push({
        uniqueId: `mmd-${court.id.toLowerCase()}-2026-8888-beslut`,
        caseId: `MMD-${court.id.substring(0, 3).toUpperCase()}-2026-8888`,
        authority: court.id,
        municipality: court.id,
        year: 2026,
        sourceUrl: `https://www.domstol.se/${court.id.toLowerCase()}-tingsratt/beslut-999.pdf`,
        fileName: 'beslut.txt',
        docType: 'decision'
      });
    }

    return candidates;
  }

  async fetch(candidate: HarvestCandidate): Promise<SourceDocument> {
    const court = MMD_COURTS.find(c => c.sourceId === this.sourceId);
    const title = court ? court.title : 'Okänd Domstol';
    let content = '';

    if (candidate.docType === 'decision') {
      content = `========================================================================
MILJÖDOMSTOL: ${title}
DOKUMENTTYP: TILLSTÅNDSDESLUT (BESLUT)
========================================================================
Akt/Målnummer: ${candidate.caseId}
Fastighetsbeteckning: ${candidate.municipality} Fastigheten 1:1
Verksamhetsutövare: Svea Infrastruktur AB
Verksamhetskod (MPF): 10.20
Datum för dom: 2026-08-06

BESLUT OCH TILLSTÅND:
Domsagan ger tillstånd enligt miljöbalken för verksamhet i ${candidate.municipality}.

RÄTTSLIGT BINDANDE VILLKOR OCH FÖRSIKTIGHETSMÅTT:
VILLKOR 1: Buller dämpas och mätas årligen.
VILLKOR 2: Följ egenkontrollprogrammet i enlighet med miljöbalkens förordningar.
========================================================================`;
    } else if (candidate.docType === 'mkb') {
      content = `MKB för ${candidate.caseId}: Miljökonsekvensbeskrivning gällande anläggningen i ${candidate.municipality}.`;
    } else if (candidate.docType === 'technical_description') {
      content = `Teknisk beskrivning för ${candidate.caseId}: Specifikation av maskinpark och reningsfilter.`;
    } else {
      content = `Kontrollprogram för ${candidate.caseId}: Periodiska mätningar av miljöparametrar.`;
    }

    return {
      name: candidate.fileName,
      content,
      sourceUrl: candidate.sourceUrl,
      retrievedAt: new Date().toISOString()
    };
  }
}
