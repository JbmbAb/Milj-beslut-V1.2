/**
 * Municipality Mappings
 * Maps Swedish municipality names to their official SCB codes.
 * Used for automatic lookup from property designations.
 */

export const MUNICIPALITY_MAPPINGS: Record<string, string> = {
  'STOCKHOLM': '0180',
  'UPPSALA': '0380', // Fixed from 3100 (which was postal code style) to SCB 0380
  'VÄSTERÅS': '1980', // SCB code for Västerås is 1980
  'GÖTEBORG': '1480',
  'MALMÖ': '1280',
  'ENKÖPING': '0381',
  'KNIVSTA': '0330',
  'HÅBO': '0305',
  'ESKILSTUNA': '0484',
  'STRÄNGNÄS': '0486',
  'NYKÖPING': '0480',
  'NORRKÖPING': '0581',
  'LINKÖPING': '0580',
  'JÖNKÖPING': '0680',
  'VÄXJÖ': '0780',
  'KALMAR': '0880',
  'VISBY': '0980', // Gotland
  'KARLSKRONA': '1080',
  'KRISTIANSTAD': '1290',
  'HELSINGBORG': '1283',
  'LUND': '1281',
  'HALMSTAD': '1380',
  'BORÅS': '1490',
  'TROLLHÄTTAN': '1488',
  'SKÖVDE': '1496',
  'KARLSTAD': '1780',
  'ÖREBRO': '1880',
  'FALUN': '2080',
  'GÄVLE': '2180',
  'HUDIKSVALL': '2184',
  'SUNDSVALL': '2281',
  'ÖSTERSUND': '2380',
  'UMEÅ': '2480',
  'SKELLEFTEÅ': '2482',
  'LULEÅ': '2580',
  'PITEÅ': '2581',
  'KIRUNA': '2584'
};

/**
 * Attempts to find a municipality code from a property designation string.
 * Example: "VÄSTERÅS GILLTUNA 1:2" -> "1980"
 */
export function lookupMunicipalityFromDesignation(designation: string): string | null {
  if (!designation) return null;
  
  const normalized = designation.trim().toUpperCase();
  const firstWord = normalized.split(/\s+/)[0];
  
  if (!firstWord) return null;
  
  return MUNICIPALITY_MAPPINGS[firstWord] || null;
}
