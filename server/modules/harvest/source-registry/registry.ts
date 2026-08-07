/**
 * 🜂 Loke Source Registry (LSF-01)
 * 
 * Lokes centrala register över alla tillåtna externa miljödatakällor i Sverige.
 * Säkrar att inga agenter körs mot oauktoriserade adresser eller okända källor.
 */

export interface SourceDefinition {
  sourceId: string;
  authority: {
    name: string;
    type: 'court' | 'county_board' | 'municipality' | 'other';
  };
  adapter: string;        // Namn på avsedd käll-adapter t.ex. 'mmd_v1', 'mpd_lansstyrelsen_v1'
  frequency: 'daily' | 'weekly' | 'monthly';
  allowedDomains: string[];
  artifactTypes: ('decision' | 'mkb' | 'technical_description' | 'control_program' | 'other')[];
}

const SOURCE_REGISTRY: Record<string, SourceDefinition> = {
  // Phase 1: Mark- och miljödomstolar (MMD)
  'mmd_nacka': {
    sourceId: 'mmd_nacka',
    authority: { name: 'Mark- och miljödomstolen vid Nacka tingsrätt', type: 'court' },
    adapter: 'mmd_v1',
    frequency: 'daily',
    allowedDomains: ['domstol.se'],
    artifactTypes: ['decision', 'mkb', 'technical_description', 'control_program']
  },
  'mmd_vaxjo': {
    sourceId: 'mmd_vaxjo',
    authority: { name: 'Mark- och miljödomstolen vid Växjö tingsrätt', type: 'court' },
    adapter: 'mmd_v1',
    frequency: 'daily',
    allowedDomains: ['domstol.se'],
    artifactTypes: ['decision', 'mkb', 'technical_description', 'control_program']
  },
  'mmd_umea': {
    sourceId: 'mmd_umea',
    authority: { name: 'Mark- och miljödomstolen vid Umeå tingsrätt', type: 'court' },
    adapter: 'mmd_v1',
    frequency: 'daily',
    allowedDomains: ['domstol.se'],
    artifactTypes: ['decision']
  },
  'mmd_ostersund': {
    sourceId: 'mmd_ostersund',
    authority: { name: 'Mark- och miljödomstolen vid Östersunds tingsrätt', type: 'court' },
    adapter: 'mmd_v1',
    frequency: 'daily',
    allowedDomains: ['domstol.se'],
    artifactTypes: ['decision']
  },
  'mmd_vanersborg': {
    sourceId: 'mmd_vanersborg',
    authority: { name: 'Mark- och miljödomstolen vid Vänersborgs tingsrätt', type: 'court' },
    adapter: 'mmd_v1',
    frequency: 'daily',
    allowedDomains: ['domstol.se'],
    artifactTypes: ['decision']
  },

  // Phase 1: Miljöprövningsdelegationer (MPD)
  'mpd_dalarna': {
    sourceId: 'mpd_dalarna',
    authority: { name: 'Miljöprövningsdelegationen i Dalarnas län', type: 'county_board' },
    adapter: 'mpd_lansstyrelsen_v1',
    frequency: 'daily',
    allowedDomains: ['lansstyrelsen.se'],
    artifactTypes: ['decision', 'mkb', 'technical_description', 'control_program']
  },
  'mpd_vastra_gotaland': {
    sourceId: 'mpd_vastra_gotaland',
    authority: { name: 'Miljöprövningsdelegationen i Västra Götalands län', type: 'county_board' },
    adapter: 'mpd_lansstyrelsen_v1',
    frequency: 'daily',
    allowedDomains: ['lansstyrelsen.se'],
    artifactTypes: ['decision', 'mkb', 'technical_description', 'control_program']
  },
  'mpd_skane': {
    sourceId: 'mpd_skane',
    authority: { name: 'Miljöprövningsdelegationen i Skåne län', type: 'county_board' },
    adapter: 'mpd_lansstyrelsen_v1',
    frequency: 'daily',
    allowedDomains: ['lansstyrelsen.se'],
    artifactTypes: ['decision', 'mkb', 'technical_description', 'control_program']
  },

  // Phase 2 Pilot-kommuner (en per stor plattformstyp)
  'kommun_karlstad_castor': {
    sourceId: 'kommun_karlstad_castor',
    authority: { name: 'Karlstads kommun (Miljönämnden)', type: 'municipality' },
    adapter: 'kommun_castor_v1',
    frequency: 'weekly',
    allowedDomains: ['karlstad.se'],
    artifactTypes: ['decision', 'control_program']
  },
  'kommun_orebro_evolution': {
    sourceId: 'kommun_orebro_evolution',
    authority: { name: 'Örebro kommun (Miljönämnden)', type: 'municipality' },
    adapter: 'kommun_evolution_v1',
    frequency: 'weekly',
    allowedDomains: ['orebro.se'],
    artifactTypes: ['decision', 'control_program']
  },
  'kommun_linkoping_w3d3': {
    sourceId: 'kommun_linkoping_w3d3',
    authority: { name: 'Linköpings kommun (Miljönämnden)', type: 'municipality' },
    adapter: 'kommun_w3d3_v1',
    frequency: 'weekly',
    allowedDomains: ['linkoping.se'],
    artifactTypes: ['decision', 'control_program']
  }
};

/**
 * Hämta en käll-definition baserat på dess unika ID
 */
export function getSourceDefinition(sourceId: string): SourceDefinition | null {
  return SOURCE_REGISTRY[sourceId] || null;
}

/**
 * Hämta alla registrerade käll-definitioner
 */
export function getAllSources(): SourceDefinition[] {
  return Object.values(SOURCE_REGISTRY);
}

/**
 * Validerar om en URL är tillåten för en given källa (förhindrar "crawler leaks")
 */
export function isUrlAllowedForSource(sourceId: string, url: string): boolean {
  const source = getSourceDefinition(sourceId);
  if (!source) return false;
  
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    
    return source.allowedDomains.some((domain) => 
      hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}
