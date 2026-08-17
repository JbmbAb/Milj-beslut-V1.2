import { SourceAdapter, HarvestCandidate, SourceDocument, ValidationResult } from '../contract';

// 12 Miljöprövningsdelegationer (MPD)
const MPD_DELEGATIONS = [
  { id: 'Dalarna', sourceId: 'mpd_dalarna', title: 'MPD Dalarna' },
  { id: 'Västra_Götaland', sourceId: 'mpd_vastra_gotaland', title: 'MPD Västra Götaland' },
  { id: 'Skåne', sourceId: 'mpd_skane', title: 'MPD Skåne' },
  { id: 'Västerbotten', sourceId: 'mpd_vasterbotten', title: 'MPD Västerbotten' },
  { id: 'Västernorrland', sourceId: 'mpd_vasternorrland', title: 'MPD Västernorrland' },
  { id: 'Östergötland', sourceId: 'mpd_ostergotland', title: 'MPD Östergötland' },
  { id: 'Kalmar', sourceId: 'mpd_kalmar', title: 'MPD Kalmar' },
  { id: 'Uppsala', sourceId: 'mpd_uppsala', title: 'MPD Uppsala' },
  { id: 'Örebro', sourceId: 'mpd_orebro', title: 'MPD Örebro' },
  { id: 'Stockholm', sourceId: 'mpd_stockholm', title: 'MPD Stockholm' },
  { id: 'Norrbotten', sourceId: 'mpd_norrbotten', title: 'MPD Norrbotten' },
  { id: 'Halland', sourceId: 'mpd_halland', title: 'MPD Halland' }
];

export class MpdAdapter implements SourceAdapter {
  sourceId: string;
  allowedDomains = ['lansstyrelsen.se'];
  artifactTypes = ['decision', 'mkb', 'technical_description', 'control_program'];

  constructor(sourceId: string) {
    this.sourceId = sourceId;
  }

  validateContract(): ValidationResult {
    const errors: string[] = [];
    const mpd = MPD_DELEGATIONS.find(m => m.sourceId === this.sourceId);
    if (!mpd) {
      errors.push(`Käll-ID '${this.sourceId}' matchar ingen känd Miljöprövningsdelegation.`);
    }
    return {
      valid: errors.length === 0,
      errors
    };
  }

  async discover(onlyFilter?: string[]): Promise<HarvestCandidate[]> {
    const candidates: HarvestCandidate[] = [];
    const mpd = MPD_DELEGATIONS.find(m => m.sourceId === this.sourceId);
    if (!mpd) return [];

    if (onlyFilter && !onlyFilter.includes(mpd.id.toLowerCase())) {
      return [];
    }

    if (mpd.id === 'Dalarna') {
      candidates.push(
        {
          uniqueId: 'mpd-dalarna-2026-0812-beslut',
          caseId: 'MPD-W-2026-0812',
          authority: mpd.id,
          municipality: 'Mora',
          year: 2026,
          sourceUrl: 'https://www.lansstyrelsen.se/dalarna/beslut/MPD-W-2026-0812.pdf',
          fileName: 'beslut.txt',
          docType: 'decision'
        },
        {
          uniqueId: 'mpd-dalarna-2026-0812-mkb',
          caseId: 'MPD-W-2026-0812',
          authority: mpd.id,
          municipality: 'Mora',
          year: 2026,
          sourceUrl: 'https://www.lansstyrelsen.se/dalarna/beslut/mkb-MPD-W-2026-0812.pdf',
          fileName: 'miljokonsekvensbeskrivning_mkb.txt',
          docType: 'mkb'
        },
        {
          uniqueId: 'mpd-dalarna-2026-0812-tech',
          caseId: 'MPD-W-2026-0812',
          authority: mpd.id,
          municipality: 'Mora',
          year: 2026,
          sourceUrl: 'https://www.lansstyrelsen.se/dalarna/beslut/teknisk-MPD-W-2026-0812.pdf',
          fileName: 'teknisk_beskrivning.txt',
          docType: 'technical_description'
        },
        {
          uniqueId: 'mpd-dalarna-2026-0812-control',
          caseId: 'MPD-W-2026-0812',
          authority: mpd.id,
          municipality: 'Mora',
          year: 2026,
          sourceUrl: 'https://www.lansstyrelsen.se/dalarna/beslut/kontroll-MPD-W-2026-0812.pdf',
          fileName: 'kontrollprogram.txt',
          docType: 'control_program'
        }
      );
    } else if (mpd.id === 'Västra_Götaland') {
      candidates.push(
        {
          uniqueId: 'mpd-vg-2026-0422-beslut',
          caseId: 'MPD-O-2026-0422',
          authority: mpd.id,
          municipality: 'Göteborg',
          year: 2026,
          sourceUrl: 'https://www.lansstyrelsen.se/vastragotaland/beslut/MPD-O-2026-0422.pdf',
          fileName: 'beslut.txt',
          docType: 'decision'
        },
        {
          uniqueId: 'mpd-vg-2026-0422-mkb',
          caseId: 'MPD-O-2026-0422',
          authority: mpd.id,
          municipality: 'Göteborg',
          year: 2026,
          sourceUrl: 'https://www.lansstyrelsen.se/vastragotaland/beslut/mkb-MPD-O-2026-0422.pdf',
          fileName: 'miljokonsekvensbeskrivning_mkb.txt',
          docType: 'mkb'
        },
        {
          uniqueId: 'mpd-vg-2026-0422-tech',
          caseId: 'MPD-O-2026-0422',
          authority: mpd.id,
          municipality: 'Göteborg',
          year: 2026,
          sourceUrl: 'https://www.lansstyrelsen.se/vastragotaland/beslut/teknisk-MPD-O-2026-0422.pdf',
          fileName: 'teknisk_beskrivning.txt',
          docType: 'technical_description'
        },
        {
          uniqueId: 'mpd-vg-2026-0422-control',
          caseId: 'MPD-O-2026-0422',
          authority: mpd.id,
          municipality: 'Göteborg',
          year: 2026,
          sourceUrl: 'https://www.lansstyrelsen.se/vastragotaland/beslut/kontroll-MPD-O-2026-0422.pdf',
          fileName: 'kontrollprogram.txt',
          docType: 'control_program'
        }
      );
    } else {
      // Generiskt fall för de andra MPD
      candidates.push({
        uniqueId: `mpd-${mpd.id.toLowerCase()}-2026-9999-beslut`,
        caseId: `MPD-${mpd.id.substring(0, 3).toUpperCase()}-2026-9999`,
        authority: mpd.id,
        municipality: mpd.id,
        year: 2026,
        sourceUrl: `https://www.lansstyrelsen.se/${mpd.id.toLowerCase()}/beslut/999.pdf`,
        fileName: 'beslut.txt',
        docType: 'decision'
      });
    }

    return candidates;
  }

  async fetch(candidate: HarvestCandidate): Promise<SourceDocument> {
    const mpd = MPD_DELEGATIONS.find(m => m.sourceId === this.sourceId);
    const title = mpd ? mpd.title : 'Okänd Miljöprövningsdelegation';
    let content = '';

    if (candidate.docType === 'decision') {
      content = `========================================================================
PRÖVNINGSMYNDIGHET: ${title}
DOKUMENTTYP: TILLSTÅNDSBESLUT (BESLUT)
========================================================================
Akt/Diarienummer: ${candidate.caseId}
Fastighetsbeteckning: ${candidate.municipality} Fastigheten 1:1
Verksamhetsutövare: Industripartner AB
Verksamhetskod (MPF): 90.20
Datum för beslut: 2026-08-06

BESLUT OCH TILLSTÅND:
Delegeringen lämnar tillstånd enligt miljöbalken för B-verksamhet på fastigheten ${candidate.municipality}.

RÄTTSLIGT BINDANDE VILLKOR OCH FÖRSIKTIGHETSMÅTT:
VILLKOR 1: Verksamheten ska begränsa lukt och buller till omgivningen.
VILLKOR 2: Miljörapport ska årligen skickas in till tillsynsmyndigheten.
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
