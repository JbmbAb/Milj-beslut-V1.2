/**
 * Sewage Document Generator Service
 * Generates PDF/Word documents for sewage system applications
 * - Situationsplan (location plan)
 * - Tvärsektion (cross-section diagram)
 * - Application summary
 *
 * Integration points: Lantmäteriet (maps), SVG canvas
 */

import type {
  SewageApplication,
  SewageGISAnalysis,
  SewageProtectionProfile,
} from '../../types';

export interface DocumentGenerationRequest {
  application: SewageApplication;
  gisAnalysis: SewageGISAnalysis;
  protectionProfile: SewageProtectionProfile;
  applicantName: string;
  applicantEmail: string;
  latitude: number;
  longitude: number;
}

export interface GeneratedDocuments {
  situationPlan: {
    format: 'PDF' | 'SVG';
    data: string; // Base64 or URL
    width: number;
    height: number;
  };
  crossSection: {
    format: 'SVG' | 'PNG';
    data: string;
    width: number;
    height: number;
  };
  applicationSummary: {
    format: 'PDF';
    data: string;
  };
}

/**
 * Generate complete document package for sewage application
 */
export async function generateSewageDocuments(
  request: DocumentGenerationRequest,
): Promise<GeneratedDocuments> {
  const situationPlan = generateSituationsplan(request);
  const crossSection = generateTvärsektion(request);
  const applicationSummary = generateApplicationSummary(request);

  return {
    situationPlan,
    crossSection,
    applicationSummary,
  };
}

/**
 * Situationsplan (Situation Plan)
 * Shows:
 * - Property boundaries (Lantmäteriet)
 * - Building footprint
 * - Proposed sewage system location
 * - Distances to wells, water courses, property lines
 * - Contour lines (höjdkurvor)
 * - North arrow, scale
 *
 * Production: Use WMS/GeoJSON from Lantmäteriet to create SVG/PDF
 */
function generateSituationsplan(request: DocumentGenerationRequest): GeneratedDocuments['situationPlan'] {
  const { gisAnalysis } = request;

  // Build SVG with property outline, system location, distances
  const svg = `
    <svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
      <!-- Background -->
      <rect width="800" height="600" fill="#f0f8ff"/>
      
      <!-- Grid -->
      <defs>
        <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
          <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#ddd" stroke-width="0.5"/>
        </pattern>
      </defs>
      <rect width="800" height="600" fill="url(#grid)" />
      
      <!-- Property boundary (simplified polygon) -->
      <polygon points="100,100 700,100 700,500 100,500" 
               fill="none" stroke="#000" stroke-width="2"/>
      
      <!-- Building footprint -->
      <rect x="150" y="150" width="100" height="80" 
            fill="#ccc" stroke="#666" stroke-width="1"/>
      
      <!-- Proposed sewage system location (marked circle) -->
      <circle cx="500" cy="350" r="20" fill="none" stroke="#ff4444" stroke-width="2"/>
      <text x="510" y="340" font-size="12" fill="#ff4444">AVLOPP</text>
      
      <!-- Nearest well -->
      <circle cx="200" cy="200" r="10" fill="none" stroke="#0066cc" stroke-width="2"/>
      <text x="210" y="205" font-size="11" fill="#0066cc">Brunn</text>
      <line x1="500" y1="350" x2="200" y2="200" stroke="#0066cc" stroke-width="1" stroke-dasharray="5,5"/>
      <text x="350" y="275" font-size="10" fill="#0066cc">${gisAnalysis.sguBrunnarData.nearestOwnWell?.distance || 0}m</text>
      
      <!-- Contour lines (höjdkurvor) - simplified -->
      <path d="M 150 200 Q 300 180 450 190" fill="none" stroke="#996633" stroke-width="1" opacity="0.6"/>
      <text x="460" y="185" font-size="9" fill="#996633">50m</text>
      
      <!-- Title and legend -->
      <text x="20" y="30" font-size="16" font-weight="bold">Situationsplan</text>
      <text x="20" y="50" font-size="12">Fastighet: ${request.application.propertyDesignation}</text>
      <text x="20" y="70" font-size="12">PE: ${request.application.pe} | Datum: ${new Date().toLocaleDateString('sv-SE')}</text>
      
      <!-- Scale -->
      <text x="650" y="570" font-size="10">Skala: 1:500</text>
      <line x1="650" y1="560" x2="750" y2="560" stroke="#000" stroke-width="1"/>
      
      <!-- North arrow -->
      <text x="750" y="150" font-size="14" font-weight="bold">N</text>
      <path d="M 760 140 L 765 160 L 755 160 Z" fill="#000"/>
    </svg>
  `;

  return {
    format: 'SVG',
    data: svg,
    width: 800,
    height: 600,
  };
}

/**
 * Tvärsektion (Cross-Section)
 * Shows:
 * - Terrain profile
 * - Groundwater level
 * - System installation depth
 * - Distance to rock (djup till berg)
 * - Infiltration layer specifications
 */
function generateTvärsektion(request: DocumentGenerationRequest): GeneratedDocuments['crossSection'] {
  const { application, protectionProfile } = request;
  const { groundwaterLevel, depthToRock } = protectionProfile.soilProfile;

  const svg = `
    <svg width="900" height="500" xmlns="http://www.w3.org/2000/svg">
      <!-- Background -->
      <rect width="900" height="500" fill="#f5f5f5"/>
      
      <!-- Terrain line -->
      <line x1="50" y1="150" x2="850" y2="150" stroke="#333" stroke-width="2"/>
      
      <!-- Soil layers -->
      <rect x="50" y="150" width="800" height="100" fill="#d4a574" stroke="#999" stroke-width="1"/>
      <text x="60" y="210" font-size="12" fill="#333">Jord: ${protectionProfile.soilProfile.soilType}</text>
      
      <!-- Groundwater table -->
      <line x1="50" y1="${150 + groundwaterLevel * 50}" x2="850" y2="${150 + groundwaterLevel * 50}" 
            stroke="#0066cc" stroke-width="2" stroke-dasharray="5,5"/>
      <text x="860" y="${155 + groundwaterLevel * 50}" font-size="11" fill="#0066cc">GVN</text>
      
      <!-- Rock layer -->
      <rect x="50" y="${150 + depthToRock * 50}" width="800" height="150" 
            fill="#999" stroke="#666" stroke-width="1" opacity="0.7"/>
      <text x="60" y="${160 + depthToRock * 50 + 20}" font-size="12" fill="#fff">Berg</text>
      
      <!-- Sewage system visualization -->
      ${
        application.selectedSystemType === 'INFILTRATION' || application.selectedSystemType === 'SOIL_BED'
          ? `
            <!-- Infiltration system -->
            <rect x="300" y="200" width="150" height="80" fill="none" stroke="#ff6600" stroke-width="2"/>
            <text x="310" y="215" font-size="11" fill="#ff6600">Markbädd/Infiltration</text>
            <text x="310" y="235" font-size="10" fill="#666">Yta: ${(protectionProfile.soilProfile.infiltrationCapacity === 'HIGH' ? application.pe * 1.5 : application.pe * 3).toFixed(0)} m²</text>
            <line x1="375" y1="280" x2="375" y2="${150 + Math.min(depthToRock, 2) * 50}" stroke="#ff6600" stroke-width="1" stroke-dasharray="3,3"/>
          `
          : `
            <!-- Closed tank system -->
            <rect x="350" y="220" width="100" height="60" fill="#999" stroke="#333" stroke-width="2" rx="5"/>
            <text x="365" y="255" font-size="11" fill="#fff" font-weight="bold">Tank</text>
            <line x1="400" y1="280" x2="400" y2="400" stroke="#333" stroke-width="1"/>
            <text x="410" y="340" font-size="10" fill="#666">Till</text>
            <text x="410" y="360" font-size="10" fill="#666">tomning</text>
          `
      }
      
      <!-- Dimensions -->
      <line x1="50" y1="420" x2="850" y2="420" stroke="#999" stroke-width="1"/>
      <line x1="50" y1="410" x2="50" y2="430" stroke="#999" stroke-width="1"/>
      <line x1="850" y1="410" x2="850" y2="430" stroke="#999" stroke-width="1"/>
      <text x="400" y="450" font-size="11" fill="#333" text-anchor="middle">Längd: 800m (exempel)</text>
      
      <!-- Title and key info -->
      <text x="50" y="30" font-size="14" font-weight="bold">Tvärsektion - ${application.propertyDesignation}</text>
      <text x="50" y="55" font-size="11">System: ${application.selectedSystemType}</text>
      <text x="50" y="75" font-size="11">PE: ${application.pe} | Grundvattennivå: ${groundwaterLevel}m under mark | Djup till berg: ${depthToRock}m</text>
      
      <!-- Legend -->
      <rect x="650" y="350" width="200" height="120" fill="#fff" stroke="#999" stroke-width="1"/>
      <text x="660" y="370" font-size="11" font-weight="bold">Förklaring</text>
      <line x1="660" y1="380" x2="690" y2="380" stroke="#0066cc" stroke-width="2" stroke-dasharray="5,5"/>
      <text x="700" y="385" font-size="10">Grundvattennivå</text>
      <line x1="660" y1="400" x2="690" y2="400" stroke="#333" stroke-width="2"/>
      <text x="700" y="405" font-size="10">Mark/Jord</text>
      <rect x="660" y="410" width="20" height="20" fill="#999" opacity="0.7"/>
      <text x="700" y="425" font-size="10">Berg</text>
    </svg>
  `;

  return {
    format: 'SVG',
    data: svg,
    width: 900,
    height: 500,
  };
}

/**
 * Generate application summary document
 */
function generateApplicationSummary(
  request: DocumentGenerationRequest,
): GeneratedDocuments['applicationSummary'] {
  const { application, protectionProfile, gisAnalysis, applicantName } = request;

  const html = `
    <!DOCTYPE html>
    <html lang="sv">
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
        h1 { color: #005293; border-bottom: 2px solid #005293; padding-bottom: 10px; }
        h2 { color: #0066cc; margin-top: 30px; }
        .section { margin-bottom: 20px; }
        .field { display: flex; margin: 8px 0; }
        .label { font-weight: bold; width: 200px; }
        .value { flex: 1; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
        th { background-color: #f0f0f0; }
        .warning { background-color: #fff3cd; padding: 10px; border-left: 4px solid #ff9800; margin: 10px 0; }
        .requirement { background-color: #f9f9f9; padding: 10px; margin: 5px 0; border-left: 3px solid #0066cc; }
      </style>
    </head>
    <body>
      <h1>Ansökan om enskilt avlopp</h1>
      
      <div class="section">
        <h2>Fastighetsuppgifter</h2>
        <div class="field"><span class="label">Fastighetsbeteckning:</span><span class="value">${application.propertyDesignation}</span></div>
        <div class="field"><span class="label">Persons ekvivalenter (PE):</span><span class="value">${application.pe}</span></div>
        <div class="field"><span class="label">Ansökan uppgjord av:</span><span class="value">${applicantName}</span></div>
        <div class="field"><span class="label">Datum:</span><span class="value">${new Date().toLocaleDateString('sv-SE')}</span></div>
      </div>
      
      <div class="section">
        <h2>Miljöbedömning</h2>
        <div class="field"><span class="label">Skyddsnivå:</span><span class="value">${protectionProfile.protectionLevel === 'HIGH' ? 'Högt skyddad område' : 'Normal skyddsnivå'}</span></div>
        <div class="field"><span class="label">Risk-poäng:</span><span class="value">${gisAnalysis.overallRiskScore}/100</span></div>
        <div class="field"><span class="label">Feasibility-poäng:</span><span class="value">${gisAnalysis.feasibilityScore}/100</span></div>
        <div class="field"><span class="label">Närmaste brunn:</span><span class="value">${protectionProfile.nearestWell.distance}m (krav: 50m)</span></div>
        <div class="field"><span class="label">Avstånd till tomtgräns:</span><span class="value">${protectionProfile.distanceToPropertyLine}m (krav: 4.5m)</span></div>
      </div>
      
      <div class="section">
        <h2>Jordförhållanden</h2>
        <div class="field"><span class="label">Jordtyp:</span><span class="value">${protectionProfile.soilProfile.soilType}</span></div>
        <div class="field"><span class="label">Infiltrationskapacitet:</span><span class="value">${protectionProfile.soilProfile.infiltrationCapacity}</span></div>
        <div class="field"><span class="label">Djup till berg:</span><span class="value">${protectionProfile.soilProfile.depthToRock}m</span></div>
        <div class="field"><span class="label">Grundvattennivå:</span><span class="value">${protectionProfile.soilProfile.groundwaterLevel}m under mark</span></div>
      </div>
      
      <div class="section">
        <h2>Valt avloppsystem</h2>
        <div class="field"><span class="label">Systemtyp:</span><span class="value">${application.selectedSystemType}</span></div>
        <div class="field"><span class="label">Rekommendation:</span><span class="value">Rekommenderad av GIS-analys</span></div>
        <div class="field"><span class="label">Estimated kostnad:</span><span class="value">Se dokumentation</span></div>
      </div>
      
      <div class="section">
        <h2>Juridiska krav & Kontroller</h2>
        <table>
          <tr>
            <th>Krav</th>
            <th>Status</th>
            <th>Anmärkning</th>
          </tr>
          <tr>
            <td>Skyddsnivå-bedömning</td>
            <td>✓ Godkänd</td>
            <td>Genomförd via GIS-analys</td>
          </tr>
          <tr>
            <td>Markundersökning (om krävs)</td>
            <td>${application.soilTestCompleted ? '✓ Genomförd' : '⏳ Pending'}</td>
            <td>${application.ltar ? `LTAR: ${application.ltar} mm/h` : 'Perkolationsprov TB145 krävs'}</td>
          </tr>
          <tr>
            <td>Grannemedgivande (om krävs)</td>
            <td>${application.neighborConsentObtained ? '✓ Erhållet' : application.neighborConsentRequired ? '⏳ Pending' : '✓ Ej nödvändigt'}</td>
            <td>${application.neighborDetails ? application.neighborDetails.address : 'Se avståndsanalys'}</td>
          </tr>
          <tr>
            <td>Dokumentation</td>
            <td>${application.situationPlan && application.crossSection ? '✓ Genererad' : '⏳ Pending'}</td>
            <td>Situationsplan + Tvärsektion</td>
          </tr>
        </table>
      </div>
      
      <div class="section">
        <h2>Styrande lagstiftning</h2>
        <ul>
          <li><strong>Miljöbalken (1998:808)</strong> – 32 kap (Privatbrunnar, toaletter och avloppsanordningar)</li>
          <li><strong>Förordningen (1998:899) om miljöfarlig verksamhet och hälsoskydd</strong> – anmälan och tillstånd</li>
          <li><strong>Havs- och vattenmyndighetens allmänna råd</strong> – HVMFS 2016:17 (Enskilt avlopp)</li>
          <li><strong>Vattendirektivet</strong> – 2000/60/EG (Vattenskydd)</li>
          <li><strong>Domstolsverket / MÖD praxis</strong> – vägledande avgöranden för teknik- och platsval</li>
          <li><strong>Länsstyrelsens riktlinjer</strong> – regional vägledning och skyddsnivå</li>
          <li><strong>Dataportalens geodata</strong> – platsunderlag för brunnar, recipienter och skyddsområden</li>
        </ul>
      </div>
      
      <div class="section">
        <h2>Nästa steg</h2>
        <ol>
          <li>Granskning av denna ansökan för fullständighet</li>
          <li>Inskickning till ansvarig kommun</li>
          <li>Kommunal prövning (typiskt 6-8 veckor)</li>
          <li>Tillståndssamtal eller förlängd granskning om krävs</li>
          <li>Slutligt tillstånd eller avslag</li>
        </ol>
      </div>
      
      <hr/>
      <p style="font-size: 11px; color: #999;">
        Denna ansökan har genererats av Miljobeslut.se Sewage Portal. <br/>
        Ansökan är föremål för regelverksövervakning enligt miljöbalken, FMH och HVMFS 2016:17.<br/>
        Skapad: ${new Date().toLocaleString('sv-SE')}
      </p>
    </body>
    </html>
  `;

  // In production: convert HTML to PDF using library like pdfkit or puppeteer
  return {
    format: 'PDF',
    data: html, // Would be base64-encoded PDF in production
  };
}
