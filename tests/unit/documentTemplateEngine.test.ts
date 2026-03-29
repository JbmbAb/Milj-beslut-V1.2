import { describe, expect, it } from 'vitest';
import {
    renderCompliancePlanTemplate,
    type TemplateVariables,
} from '../../services/documentTemplateEngine';

// ─── helpers ─────────────────────────────────────────────────────────────────

function baseVars(overrides: Partial<TemplateVariables> = {}): TemplateVariables {
    return {
        projectName: 'TestProjekt',
        municipality: 'Teststad',
        wasteTypes: ['17 05 04*', '17 09 04'],
        totalVolumeTons: 500,
        riskScore: 'MEDIUM',
        riskFactors: [],
        ...overrides,
    };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('renderCompliancePlanTemplate – content', () => {
    it('contains the project name', () => {
        const output = renderCompliancePlanTemplate(baseVars({ projectName: 'MittProjekt' }));
        expect(output).toContain('MittProjekt');
    });

    it('contains the municipality', () => {
        const output = renderCompliancePlanTemplate(baseVars({ municipality: 'Stockholm' }));
        expect(output).toContain('Stockholm');
    });

    it('lists all waste types', () => {
        const output = renderCompliancePlanTemplate(baseVars({ wasteTypes: ['17 05 04*', '20 01 27*'] }));
        expect(output).toContain('17 05 04*');
        expect(output).toContain('20 01 27*');
    });

    it('contains the volume', () => {
        const output = renderCompliancePlanTemplate(baseVars({ totalVolumeTons: 12345 }));
        expect(output).toContain('12345');
    });

    it('contains the risk score', () => {
        const output = renderCompliancePlanTemplate(baseVars({ riskScore: 'HIGH' }));
        expect(output).toContain('HIGH');
    });

    it('contains a generated date (YYYY-MM-DD format)', () => {
        const output = renderCompliancePlanTemplate(baseVars());
        expect(output).toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    it('contains the Miljöbalken reference', () => {
        const output = renderCompliancePlanTemplate(baseVars());
        expect(output).toContain('Miljöbalken');
    });
});

describe('renderCompliancePlanTemplate – risk factors', () => {
    it('shows placeholder text when riskFactors is empty', () => {
        const output = renderCompliancePlanTemplate(baseVars({ riskFactors: [] }));
        expect(output).toContain('Inga förhöjda risker');
    });

    it('lists each risk factor with a dash prefix', () => {
        const factors = ['Farligt avfall identifierat.', 'Grundvatten nära.'];
        const output = renderCompliancePlanTemplate(baseVars({ riskFactors: factors }));
        expect(output).toContain('- Farligt avfall identifierat.');
        expect(output).toContain('- Grundvatten nära.');
    });

    it('does NOT include the empty-factors placeholder when factors exist', () => {
        const output = renderCompliancePlanTemplate(baseVars({ riskFactors: ['En faktor'] }));
        expect(output).not.toContain('Inga förhöjda risker');
    });
});

describe('renderCompliancePlanTemplate – ai mitigation advice', () => {
    it('shows default placeholder when aiMitigationAdvice is absent', () => {
        const output = renderCompliancePlanTemplate(baseVars({ aiMitigationAdvice: undefined }));
        expect(output).toContain('Inväntar detaljerad rådgivning');
    });

    it('shows custom advice when provided', () => {
        const output = renderCompliancePlanTemplate(
            baseVars({ aiMitigationAdvice: 'Installera läckagebarriär.' }),
        );
        expect(output).toContain('Installera läckagebarriär.');
        expect(output).not.toContain('Inväntar detaljerad rådgivning');
    });
});

describe('renderCompliancePlanTemplate – structural', () => {
    it('returns a non-empty string', () => {
        const output = renderCompliancePlanTemplate(baseVars());
        expect(typeof output).toBe('string');
        expect(output.length).toBeGreaterThan(100);
    });

    it('contains the section headers', () => {
        const output = renderCompliancePlanTemplate(baseVars());
        expect(output).toContain('MILJÖKONTROLLPLAN');
        expect(output).toContain('BAKGRUND OCH SYFTE');
        expect(output).toContain('OMFATTNING');
        expect(output).toContain('MILJÖRISKANALYS');
        expect(output).toContain('RISKMINIMERANDE');
    });

    it('contains a Dokument-ID tag', () => {
        const output = renderCompliancePlanTemplate(baseVars());
        expect(output).toContain('Dokument-ID');
    });
});
