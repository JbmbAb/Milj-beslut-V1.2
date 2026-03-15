/**
 * lantmaterietMock.ts
 * Simulerar svar från Lantmäteriets Fastighetsregister (SFF-format).
 * Används för att ge en autentisk upplevelse innan skarpa konton är på plats.
 */

export interface PropertyData {
    propertyId: string; // t.ex. NACKA SICKLAÖN 13:4
    municipality: string;
    area: number;
    ownerType: 'Privat' | 'Juridisk person' | 'Statlig/Kommunal';
    rights: string[];
    encumbrances: string[]; // Belastningar
    lastUpdated: string;
}

const MOCK_PROPERTIES: Record<string, PropertyData> = {
    'NACKA SICKLAÖN 13:4': {
        propertyId: 'NACKA SICKLAÖN 13:4',
        municipality: 'Nacka',
        area: 4500,
        ownerType: 'Juridisk person',
        rights: ['Officialservitut väg', 'Ledningsrätt starkström'],
        encumbrances: ['Nyttjanderätt tele'],
        lastUpdated: '2025-11-20'
    },
    'STOCKHOLM KUNGSHOLMEN 1:1': {
        propertyId: 'STOCKHOLM KUNGSHOLMEN 1:1',
        municipality: 'Stockholm',
        area: 12000,
        ownerType: 'Statlig/Kommunal',
        rights: ['Gångservitut'],
        encumbrances: [],
        lastUpdated: '2026-01-15'
    }
};

/**
 * Simulerar ett anrop till Lantmäteriets register.
 * Om fastigheten inte finns returneras en generisk placeholder-data för att behålla flödet.
 */
export async function getPropertyExtract(propertyId: string): Promise<PropertyData> {
    // Simulera nätverkslatens
    await new Promise(resolve => setTimeout(resolve, 600));

    const normalizedId = propertyId.toUpperCase().trim();
    if (MOCK_PROPERTIES[normalizedId]) {
        return MOCK_PROPERTIES[normalizedId];
    }

    // Fallback för okända fastigheter
    return {
        propertyId: normalizedId || 'OKÄND FASTIGHET',
        municipality: normalizedId.split(' ')[0] || 'Okänd',
        area: 0,
        ownerType: 'Privat',
        rights: [],
        encumbrances: [],
        lastUpdated: new Date().toISOString().split('T')[0]
    };
}
