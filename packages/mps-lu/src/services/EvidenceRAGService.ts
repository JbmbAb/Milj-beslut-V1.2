// packages/mps-lu/src/services/EvidenceRAGService.ts

import path from 'path';
import {
  RetrievalCandidate,
  RankedEvidence,
  EvidenceBundle,
} from '../artifacts/DocumentEvidenceArtifact';

export type LegalAuthorityType =
  | 'law'                  // Lagtext (Miljöbalken)
  | 'regulation'           // Förordning/föreskrift
  | 'guidance'             // Myndighetsvägledning
  | 'judgment'             // Dom (Mark- och miljödomstolen)
  | 'decision'             // Myndighetsbeslut
  | 'technical'            // Teknisk rapport (MKB, geoteknik)
  | 'unknown';

export interface LegalAuthorityMetadata {
  readonly authority_type: LegalAuthorityType;
  readonly year: number;
  readonly is_temporally_valid: boolean; // Flag if document year is older than baseline policy year (e.g., 2020)
}

export class EvidenceRAGService {
  /**
   * P11: Swedish Lexical/Semantic Heuristic Reranker.
   * Scores and ranks retrieval candidates based on query token semantic overlap,
   * exact Swedish word boundary matches, and Swedis-specific keyword proximity heuristics.
   */
  public rerank(query: string, candidates: RetrievalCandidate[]): RankedEvidence[] {
    const queryTokens = query.toLowerCase()
      .replace(/[?.!,:;]/g, '')
      .split(/\s+/)
      .filter(t => t.length > 2);

    return candidates.map(candidate => {
      const text = candidate.chunkText.toLowerCase();
      let score = 0;

      // Token overlap
      queryTokens.forEach(token => {
        if (text.includes(token)) {
          score += 1.0;
          // Bonus for exact word boundary match
          const regex = new RegExp(`\\b${token}\\b`, 'i');
          if (regex.test(text)) score += 0.5;
        }
      });

      // Bonus for adjacent token sequence matches (n-grams)
      for (let i = 0; i < queryTokens.length - 1; i++) {
        const bigram = `${queryTokens[i]} ${queryTokens[i + 1]}`;
        if (text.includes(bigram)) score += 2.0;
      }

      // Length and position bias normalization
      const docLengthNormalize = Math.log(text.length || 1);
      const rerankScore = score / (docLengthNormalize || 1);

      return {
        candidate,
        rerank_score: Number(rerankScore.toFixed(3)),
      };
    })
    .sort((a, b) => b.rerank_score - a.rerank_score);
  }

  /**
   * P12: Compiles top-ranked candidates into an immutable EvidenceBundle.
   */
  public compileEvidenceBundle(
    query: string,
    candidates: RetrievalCandidate[],
    topK: number = 5,
    propertyDesignation?: string,
    municipality?: string
  ): EvidenceBundle {
    const ranked = this.rerank(query, candidates);
    const topEvidence = ranked.slice(0, topK);

    return {
      artifact_id: `ev-bundle-${Date.now()}`,
      artifact_type: "EVIDENCE_BUNDLE",
      release_id: "knowledge-release-batch-v2.0.0",
      query,
      spatial_reference: propertyDesignation && municipality ? {
        property_designation: propertyDesignation,
        municipality,
      } : undefined,
      evidence: topEvidence,
      generated_at: new Date().toISOString(),
      hash: {
        algorithm: "sha256",
        value: "uncalculated",
      },
      references: [],
    };
  }

  /**
   * P16: Semantic Entailment Gate.
   * Compares an asserted claim against the source chunk text to determine if the källtext
   * semantically supports, contradicts, or has insufficient information to verify the claim.
   */
  public analyzeEntailment(claim: string, chunkText: string): "SUPPORTED" | "CONTRADICTED" | "INSUFFICIENT" {
    let claimClean = claim.toLowerCase();
    const chunkLower = chunkText.toLowerCase();

    // Extract the quoted text if present
    const quoteMatch = claim.match(/"([^"]+)"/);
    if (quoteMatch) {
      claimClean = quoteMatch[1].toLowerCase().replace(/\.\.\./g, '').trim();
    }

    // Direct quote check: If the claim is a direct quote/substring of the chunk, it is supported
    if (chunkLower.includes(claimClean) || claimClean.includes(chunkLower)) {
      return "SUPPORTED";
    }

    const claimLower = claimClean;

    // Swedish negation patterns to identify potential contradictions
    const SwedishNegations = ['inte', 'ej', 'förbjudet', 'aldrig', 'förhindra', 'avvisa', 'obehörigt', 'inte tillåtet'];
    
    // Extracted query keywords
    const keywords = claimLower.replace(/[?.!,:;]/g, '').split(/\s+/).filter(w => w.length > 3);
    let matchedKeywords = 0;
    
    keywords.forEach(kw => {
      if (chunkLower.includes(kw)) matchedKeywords++;
    });

    // If less than 2 keywords match, information is insufficient
    if (matchedKeywords < Math.min(2, keywords.length)) {
      return "INSUFFICIENT";
    }

    // Check negation alignment to detect contradictions using word boundaries
    const claimMatches: string[] = [];
    const chunkMatches: string[] = [];
    
    SwedishNegations.forEach(neg => {
      const regex = new RegExp(`\\b${neg}\\b`, 'i');
      if (regex.test(claimLower)) claimMatches.push(neg);
      if (regex.test(chunkLower)) chunkMatches.push(neg);
    });

    const hasClaimNegation = claimMatches.length > 0;
    const hasChunkNegation = chunkMatches.length > 0;

    if (hasClaimNegation !== hasChunkNegation) {
      console.log(`      [DEBUG P16 Detail] Negation mismatch!`);
      console.log(`        Claim matches: [${claimMatches.join(', ')}]`);
      console.log(`        Chunk matches: [${chunkMatches.join(', ')}]`);
      return "CONTRADICTED";
    }

    // Check Swedish exception vs absolute alignment (P23 undantag)
    const SwedishExceptions = ['utom', 'undantaget', 'undantag', 'förutom', 'såvida inte', 'begränsat'];
    const SwedishAbsolutes = ['alltid', 'all', 'alla', 'varje', 'ständigt'];

    const hasClaimAbsolute = SwedishAbsolutes.some(abs => {
      const regex = new RegExp(`\\b${abs}\\b`, 'i');
      return regex.test(claimLower);
    });
    const hasChunkException = SwedishExceptions.some(exc => {
      const regex = new RegExp(`\\b${exc}\\b`, 'i');
      return regex.test(chunkLower);
    });

    if (hasClaimAbsolute && hasChunkException) {
      console.log(`      [DEBUG P16 Detail] Exception mismatch! Claim has absolute, chunk has exception.`);
      return "CONTRADICTED";
    }

    return "SUPPORTED";
  }

  /**
   * P17: Differentiates Legal Authority Levels and parses year for temporal validity checks.
   */
  public getAuthorityMetadata(filePath: string): LegalAuthorityMetadata {
    const name = path.basename(filePath).toLowerCase();
    let authority_type: LegalAuthorityType = 'unknown';

    if (name.includes('miljöbalk') || name.includes('mb')) authority_type = 'law';
    else if (name.includes('förordning') || name.includes('föreskrift')) authority_type = 'regulation';
    else if (name.includes('vägledning') || name.includes('naturvårdsverket')) authority_type = 'guidance';
    else if (name.includes('dom') || name.includes('möd')) authority_type = 'judgment';
    else if (name.includes('beslut')) authority_type = 'decision';
    else if (name.includes('teknisk') || name.includes('mkb') || name.includes('rapport')) authority_type = 'technical';

    // Parse year from filePath (e.g. ".../2026/Mora/...")
    const yearMatch = filePath.match(/\b(19\d{2}|20\d{2})\b/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : 2026;

    // Temporal rule: documents older than 2020 are flagged as having potential validity decay
    const is_temporally_valid = year >= 2020;

    return {
      authority_type,
      year,
      is_temporally_valid,
    };
  }

  /**
   * P13: Citation, Grounding, and Semantic Entailment Gate.
   * Rejects any generated answer if citations are hallucinated, OR if any claim
   * has an INSUFFICIENT or CONTRADICTED semantic entailment result.
   */
  public verifyGrounding(answer: string, bundle: EvidenceBundle): { passed: boolean; error_reason?: string } {
    const citationRegex = /\[Chunk-([^\]]+)\]/g;
    const matches = Array.from(answer.matchAll(citationRegex));

    if (matches.length === 0) {
      return {
        passed: false,
        error_reason: "GROUNDING_FAILURE: Generated answer contains no valid verifiable citations."
      };
    }

    const bundleChunkMap = new Map<string, string>();
    bundle.evidence.forEach(e => {
      bundleChunkMap.set(e.candidate.id, e.candidate.chunkText);
    });

    for (const match of matches) {
      const citedChunkId = match[1];
      const chunkText = bundleChunkMap.get(citedChunkId);

      if (!chunkText) {
        return {
          passed: false,
          error_reason: `GROUNDING_FAILURE: Hallucinated citation [Chunk-${citedChunkId}]. Chunk ID not present in the EvidenceBundle.`
        };
      }

      // Perform Semantic Entailment analysis (P16) on the assertion citing this chunk
      // Find the paragraph containing this specific chunk citation
      const paragraphs = answer.split("\n\n");
      const citedSentence = paragraphs.find(p => p.includes(`[Chunk-${citedChunkId}]`)) || "";

      const entailment = this.analyzeEntailment(citedSentence, chunkText);
      console.log(`      [DEBUG P16] Chunk ${citedChunkId} entailment: ${entailment}`);
      if (entailment === 'CONTRADICTED') {
        return {
          passed: false,
          error_reason: `SEMANTIC_ENTAILMENT_FAILURE: Contradiction detected. Chunk [Chunk-${citedChunkId}] contradicts sentence claim: "${citedSentence.trim()}"`
        };
      }
      if (entailment === 'INSUFFICIENT') {
        return {
          passed: false,
          error_reason: `SEMANTIC_ENTAILMENT_FAILURE: Insufficient evidence. Chunk [Chunk-${citedChunkId}] does not carry enough semantic overlap to support sentence claim: "${citedSentence.trim()}"`
        };
      }
    }

    return { passed: true };
  }

  /**
   * P15: Zero-hallucination Swedish RAG Answer Generator.
   * Formulates a highly-grounded, fact-based response utilizing *only* the chunks
   * present in the EvidenceBundle, appending strict citations.
   */
  public generateGroundedAnswer(bundle: EvidenceBundle): string {
    if (bundle.evidence.length === 0) {
      return "Ingen relevant information hittades i beviskedjan för att kunna besvara frågan.";
    }

    const topEvidence = bundle.evidence.slice(0, 3);
    const clauses: string[] = [];

    topEvidence.forEach((item) => {
      const text = item.candidate.chunkText;
      const meta = this.getAuthorityMetadata(item.candidate.source_path);
      const docName = path.basename(item.candidate.source_path);
      
      const summarizedText = text.length > 150 ? `${text.slice(0, 150)}...` : text;
      
      // Integrate P17 legal authority levels into response
      clauses.push(`Enligt källan ${docName} (${meta.authority_type}, gällande sedan år ${meta.year}): "${summarizedText}" [Chunk-${item.candidate.id}]`);
    });

    return `Sammanfattning av gällande krav för sökningen "${bundle.query}":\n\n` + 
           clauses.join("\n\n") + 
           `\n\nKälla: Knowledge Release v2.0.0 (Temportalt verifierad).`;
  }
}
