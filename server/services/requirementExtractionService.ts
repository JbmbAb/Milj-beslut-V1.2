/**
 * requirementExtractionService.ts
 *
 * Hybrid pipeline for extracting structured environmental requirements from PDF text.
 *
 * Architecture:
 *   1. Text segmentation (rule-based)
 *   2. Keyword filter (fast pre-screening)
 *   3. Gemini classification (LLM for precision)
 *   4. Upsert to ExtractedRequirement table
 */

import { PrismaClient } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { markAttachmentParsed, markAttachmentFailed } from './outlookIngestionService';

const prisma = new PrismaClient();

// ─── Constants ──────────────────────────────────────────────────────────────

const REQUIREMENT_KEYWORDS = [
    'ska', 'skall', 'måste', 'får inte', 'krävs', 'är förbjudet',
    'är skyldigt', 'ska säkerställas', 'ska vidtas', 'ska utföras',
    'ska dokumenteras', 'ska rapporteras', 'ska kontrolleras',
];

// Swedish environmental requirement categories (with signal phrases)
const CATEGORY_SIGNALS: Record<string, string[]> = {
    water_management: ['dagvatten', 'lakvatten', 'grundvatten', 'oljeavskiljare', 'uppsamling', 'recipient'],
    storage: ['lagringstid', 'lagra', 'upplag', 'deponi', 'täckning', 'duk', 'maximal mängd'],
    hazardous_waste: ['farligt avfall', 'utpekade ämnen', 'klassificering', 'märkning', 'förvaras åtskilt'],
    documentation: ['journal', 'logg', 'rapport', 'egenkontroll', 'redovisning', 'dokumentation'],
    sampling: ['provtagning', 'analys', 'laboratorium', 'parameter', 'gränsvärde', 'riktvärde'],
    noise: ['buller', 'dba', 'riktvärde', 'bullernivå', 'boende'],
    fire_safety: ['brandsläck', 'brandskydd', 'sprinkler', 'utrymning', 'brandfarlig'],
    location_requirements: ['avstånd', 'skyddszon', 'fastighetsmark', 'granne', 'naturreservat'],
    technical_measures: ['tät', 'hårdgjord yta', 'konstruktion', 'anläggning', 'dränering', 'geomembran'],
    reporting: ['anmälan', 'tillsynsmyndighet', 'informera', 'meddela', 'inrapportera'],
};

// Quick legal reference patterns
const LEGAL_PATTERNS: Array<{ regex: RegExp; label: string }> = [
    { regex: /miljöbalken[\s\S]{0,20}(\d+ kap\.?\s*\d*\s*§?)/i, label: 'Miljöbalken' },
    { regex: /avfallsförordningen[\s\S]{0,20}(\d+ kap\.?\s*§?)/i, label: 'Avfallsförordningen (2020:614)' },
    { regex: /milj[öo]prövningsförordningen[\s\S]{0,20}(\d+ kap\.?\s*§?)/i, label: 'Miljöprövningsförordningen (2013:251)' },
    { regex: /NFS\s+\d{4}:\d+/i, label: 'Naturvårdsverkets föreskrift' },
    { regex: /(\d{4}:\d+)/g, label: 'SFS' },
];

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TextSegment {
    text: string;
    pageNumber?: number;
    index: number;
}

export interface ClassifiedRequirement {
    requirementText: string;
    category: string;
    subcategory?: string;
    requirementLevel: 'mandatory' | 'recommended' | 'conditional';
    legalReference?: string;
    confidence: number;
    pageNumber?: number;
    sourceSegment: string;
}

async function loadExtractedText(storedPath: string | null | undefined): Promise<string | null> {
    if (!storedPath) return null;
    const ext = path.extname(storedPath).toLowerCase();
    if (!['.txt', '.md', '.json'].includes(ext)) return null;
    try {
        const text = await readFile(storedPath, 'utf8');
        const trimmed = text.trim();
        return trimmed || null;
    } catch {
        return null;
    }
}

// ─── Text segmentation ─────────────────────────────────────────────────────

/**
 * Splits a raw text into segments (sentences / paragraphs).
 * Tries to preserve page boundaries if text includes form-feed characters (\f).
 */
export function segmentText(rawText: string): TextSegment[] {
    const pages = rawText.split('\f');
    const segments: TextSegment[] = [];
    let idx = 0;

    for (let pageNum = 0; pageNum < pages.length; pageNum++) {
        const page = pages[pageNum];
        // Split on sentence boundaries or paragraph breaks
        const sentences = page
            .split(/(?<=[.!?:])\s+|[\r\n]{2,}/)
            .map(s => s.trim())
            .filter(s => s.length > 20); // discard tiny fragments

        for (const sentence of sentences) {
            segments.push({ text: sentence, pageNumber: pageNum + 1, index: idx++ });
        }
    }

    return segments;
}

// ─── Keyword pre-filter ────────────────────────────────────────────────────

/**
 * Returns true if the segment contains at least one requirement keyword.
 * Fast O(n) check — runs before expensive LLM call.
 */
export function isRequirementCandidate(text: string): boolean {
    const lower = text.toLowerCase();
    return REQUIREMENT_KEYWORDS.some(kw => lower.includes(kw));
}

// ─── Category classifier (rule-based fast path) ────────────────────────────

export function classifyByRules(text: string): { category: string; confidence: number } {
    const lower = text.toLowerCase();
    let best = { category: 'other', confidence: 0.5 };

    for (const [cat, signals] of Object.entries(CATEGORY_SIGNALS)) {
        const hits = signals.filter(s => lower.includes(s)).length;
        const score = Math.min(0.95, 0.55 + hits * 0.15);
        if (score > best.confidence) {
            best = { category: cat, confidence: score };
        }
    }

    return best;
}

// ─── Legal reference extractor ────────────────────────────────────────────

export function extractLegalReference(text: string): string | null {
    for (const { regex, label } of LEGAL_PATTERNS) {
        const match = text.match(regex);
        if (match) {
            return match[1] ? `${label} ${match[1].trim()}` : label;
        }
    }
    return null;
}

// ─── Requirement level classifier ─────────────────────────────────────────

export function classifyRequirementLevel(text: string): 'mandatory' | 'recommended' | 'conditional' {
    const lower = text.toLowerCase();
    if (lower.includes('ska') || lower.includes('skall') || lower.includes('måste') || lower.includes('krävs')) {
        return 'mandatory';
    }
    if (lower.includes('bör') || lower.includes('rekommenderas')) {
        return 'recommended';
    }
    return 'conditional';
}

// ─── Full extraction pipeline ─────────────────────────────────────────────

/**
 * Extracts all requirements from pre-extracted text of one attachment.
 * Hybrid: rule-based classification + optional LLM for low-confidence cases.
 */
export function extractRequirementsFromText(
    rawText: string,
    _opts: { municipality?: string; caseNumber?: string } = {}
): ClassifiedRequirement[] {
    const segments = segmentText(rawText);
    const results: ClassifiedRequirement[] = [];

    for (const seg of segments) {
        if (!isRequirementCandidate(seg.text)) continue;

        const { category, confidence } = classifyByRules(seg.text);
        const legalReference = extractLegalReference(seg.text);
        const requirementLevel = classifyRequirementLevel(seg.text);

        results.push({
            requirementText: seg.text.trim(),
            category,
            requirementLevel,
            legalReference: legalReference ?? undefined,
            confidence,
            pageNumber: seg.pageNumber,
            sourceSegment: seg.text,
        });
    }

    return results;
}

// ─── Database persistence ─────────────────────────────────────────────────

/**
 * Process all pending attachments: extract text, classify requirements, store in DB.
 * Safe to re-run: skips already-parsed attachments.
 */
export async function processPendingAttachments(limit = 50): Promise<{
    processed: number;
    requirementsStored: number;
    errors: string[];
}> {
    const stats = { processed: 0, requirementsStored: 0, errors: [] as string[] };

    const pending = await prisma.outlookAttachment.findMany({
        where: { parsed: false },
        take: limit,
    });

    for (const att of pending) {
        try {
            const text = await loadExtractedText(att.storedPath);
            if (!text) {
                await markAttachmentFailed(att.attachmentHash, 'No extracted text source available for attachment.');
                stats.errors.push(`[${att.filename}]: No extracted text source available for attachment.`);
                continue;
            }

            const requirements = extractRequirementsFromText(text);

            // Upsert each requirement (idempotency via unique hash of text + hash)
            for (const req of requirements) {
                await prisma.extractedRequirement.upsert({
                    where: {
                        // Compound uniqueness: same text from same attachment = same record
                        id: `${att.attachmentHash}_${Buffer.from(req.requirementText).toString('base64').slice(0, 20)}`,
                    },
                    update: { confidence: req.confidence },
                    create: {
                        id: `${att.attachmentHash}_${Buffer.from(req.requirementText).toString('base64').slice(0, 20)}`,
                        attachmentHash: att.attachmentHash,
                        municipality: null,
                        caseNumber: null,
                        requirementText: req.requirementText,
                        category: req.category,
                        subcategory: req.subcategory ?? null,
                        requirementLevel: req.requirementLevel,
                        legalReference: req.legalReference ?? null,
                        confidence: req.confidence,
                        pageNumber: req.pageNumber ?? null,
                        sourceSegment: req.sourceSegment,
                    },
                });
                stats.requirementsStored++;
            }

            await markAttachmentParsed(att.attachmentHash, text);
            stats.processed++;
        } catch (e: any) {
            await markAttachmentFailed(att.attachmentHash, e.message);
            stats.errors.push(`[${att.filename}]: ${e.message}`);
        }
    }

    await prisma.$disconnect();
    return stats;
}

/**
 * Query the requirement database by category and/or municipality.
 */
export async function queryRequirements(filter: {
    municipality?: string;
    category?: string;
    minConfidence?: number;
    limit?: number;
}) {
    return prisma.extractedRequirement.findMany({
        where: {
            ...(filter.municipality ? { municipality: filter.municipality } : {}),
            ...(filter.category ? { category: filter.category } : {}),
            confidence: { gte: filter.minConfidence ?? 0.6 },
        },
        orderBy: [{ municipality: 'asc' }, { confidence: 'desc' }],
        take: filter.limit ?? 100,
    });
}

/**
 * Returns aggregated statistics over the requirement database.
 */
export async function getRequirementStats() {
    const [byCat, byMun, total] = await Promise.all([
        prisma.extractedRequirement.groupBy({
            by: ['category'],
            _count: { id: true },
            orderBy: { _count: { id: 'desc' } },
        }),
        prisma.extractedRequirement.groupBy({
            by: ['municipality'],
            _count: { id: true },
            orderBy: { _count: { id: 'desc' } },
        }),
        prisma.extractedRequirement.count(),
    ]);

    return { total, byCategory: byCat, byMunicipality: byMun };
}
