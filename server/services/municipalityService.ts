/**
 * municipalityService.ts
 * Logic for calculating and retrieving Tillsynsindex and municipality insights.
 * For the demo, this uses a combination of DB counts and mock profiling.
 */
import { prisma } from '../db/prisma';

export interface MunicipalityInsight {
    name: string;
    index: number; // 0.0 - 1.0
    ranking: number; // 1 - 290
    commonRisks: string[];
    commonRequirements: string[];
    stats: {
        avgRequirements: number;
        riskCoveragePct: number;
        documentationLevel: 'Låg' | 'Medel' | 'Hög';
    };
    patterns: string[];
}

const _MOCK_PROFILES: Record<string, Partial<MunicipalityInsight>> = {
    'ORSA': {
        name: 'Orsa',
        index: 0.42,
        ranking: 185,
        commonRisks: ['Buller', 'Damm', 'Transporter'],
        commonRequirements: ['Skyddsvallar', 'Begränsade arbetstider'],
        stats: {
            avgRequirements: 4.2,
            riskCoveragePct: 45,
            documentationLevel: 'Låg',
        },
        patterns: ['Standardiserade krav', 'Geografisk variation (Låg)']
    },
    'STOCKHOLM': {
        name: 'Stockholm',
        index: 0.88,
        ranking: 12,
        commonRisks: ['Dagvatten', 'Lakvatten', 'Förorenad mark', 'Byggbuller'],
        commonRequirements: ['Oljeavskiljare', 'Provtagningsplan', 'Täthetskontroll'],
        stats: {
            avgRequirements: 12.5,
            riskCoveragePct: 92,
            documentationLevel: 'Hög',
        },
        patterns: ['Hydrologiskt fokus', 'Dokumentationsbaserad tillsyn']
    },
    'NACKA': {
        name: 'Nacka',
        index: 0.82,
        ranking: 24,
        commonRisks: ['Vattenskyddsområde', 'Schaktmassor', 'Buller'],
        commonRequirements: ['Invallning', 'Journalföring', 'Recipientskydd'],
        stats: {
            avgRequirements: 9.8,
            riskCoveragePct: 88,
            documentationLevel: 'Medel',
        },
        patterns: ['Riskbaserad tillsyn', 'Hydrologiskt fokus']
    }
};

export async function getMunicipalityInsight(name: string): Promise<MunicipalityInsight> {
    const normalizedRaw = name.trim();
    const normalizedUpper = normalizedRaw.toUpperCase();

    // 1. Fetch case and requirement stats from DB
    const stats: any[] = await prisma.$queryRaw`
        SELECT 
            COUNT(r.id) as req_count,
            COUNT(DISTINCT c.id) as case_count,
            CAST(COUNT(r.id) AS FLOAT) / NULLIF(COUNT(DISTINCT c.id), 0) as avg_reqs
        FROM "RequirementCase" c
        JOIN "RequirementRecord" r ON r."caseId" = c.id
        WHERE UPPER(c.municipality) = ${normalizedUpper}
    `;

    const muniStats = stats[0] || { req_count: 0, case_count: 0, avg_reqs: 0 };
    const avgReqs = Number(muniStats.avg_reqs || 0);

    // 2. Fetch category distribution
    const categories: any[] = await prisma.$queryRaw`
        SELECT category, COUNT(*) as count
        FROM "RequirementRecord" r
        JOIN "RequirementCase" c ON r."caseId" = c.id
        WHERE UPPER(c.municipality) = ${normalizedUpper}
        GROUP BY category
        ORDER BY count DESC
    `;

    // 3. Compute Dimensions
    // Dim 1: Extent (Normalized 0-1 based on a max of ~50 avg reqs seen in data)
    const dimExtent = Math.min(1, avgReqs / 50);

    // Dim 2: Risk Focus (How many unique categories out of 6 standard ones)
    const uniqueCats = categories.filter(c => c.category !== 'Ovrigt').length;
    const dimRiskFocus = Math.min(1, uniqueCats / 6);

    // Dim 3: Documentation Level
    const docReqs = categories.find(c => c.category === 'KontrollProvtagning')?.count || 0;
    const totalReqs = Number(muniStats.req_count || 1);
    const docRatio = Number(docReqs) / totalReqs;
    const dimDoc = Math.min(1, docRatio * 10); // Scale up small ratios

    // Composite Index (weighted)
    const index = (dimExtent * 0.5 + dimRiskFocus * 0.3 + dimDoc * 0.2);

    // 4. Derive patterns and risks
    const patterns: string[] = [];
    if (avgReqs > 30) patterns.push('Omfattande kravbild');
    if (docRatio > 0.1) patterns.push('Dokumentationsbaserad tillsyn');
    if (categories.some(c => c.category === 'DagvattenLakvatten' && (Number(c.count) / Number(totalReqs)) > 0.05)) {
        patterns.push('Hydrologiskt fokus');
    }
    if (uniqueCats >= 4) patterns.push('Bred riskprofil');

    const commonRisks = categories
        .filter(c => c.category !== 'Ovrigt')
        .slice(0, 3)
        .map(c => {
            if (c.category === 'DagvattenLakvatten') return 'Vattenförorening';
            if (c.category === 'Ytkonstruktion') return 'Markförorening';
            if (c.category === 'Storningsskydd') return 'Buller & Damm';
            if (c.category === 'LagringVolymTid') return 'Brand & Spill';
            return c.category;
        });

    const commonRequirements = categories
        .filter(c => c.category !== 'Ovrigt')
        .slice(0, 3)
        .map(c => {
            if (c.category === 'KontrollProvtagning') return 'Provtagningsplan';
            if (c.category === 'Ytkonstruktion') return 'Tät platta / Invallning';
            if (c.category === 'DagvattenLakvatten') return 'Oljeavskiljare';
            if (c.category === 'LagringVolymTid') return 'Journalföring av mängder';
            return `Krav inom ${c.category}`;
        });

    // Ranking (Mock for now, but could be global query or fixed table)
    const ranking = Math.max(1, 290 - Math.round(index * 280));

    return {
        name: normalizedRaw,
        index: Number(index.toFixed(2)) || 0.45, // Fallback to neutral if no data
        ranking,
        commonRisks: commonRisks.length > 0 ? commonRisks : ['Allmänna miljörisker'],
        commonRequirements: commonRequirements.length > 0 ? commonRequirements : ['Egenkontroll'],
        stats: {
            avgRequirements: Number(avgReqs.toFixed(1)),
            riskCoveragePct: Math.round(dimRiskFocus * 100),
            documentationLevel: docRatio > 0.15 ? 'Hög' : docRatio > 0.05 ? 'Medel' : 'Låg',
        },
        patterns: patterns.length > 0 ? patterns : ['Standardiserad tillsyn']
    };
}
