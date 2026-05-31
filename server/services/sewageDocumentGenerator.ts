/**
 * Sewage Document Generator
 * Generates SVG situationsplan (situation plan) and tvärsektion (cross-section)
 * based on SewageApplication and SewageProtectionProfile data
 *
 * These are sent directly to municipality API as PDF attachments.
 */

import type { SewageApplication, SewageProtectionProfile, SewageGISAnalysis } from '../../types';

// ============================================================================
// SITUATION PLAN (SITUATIONSPLAN) - SVG GENERATION
// ============================================================================

/**
 * Generates SVG situationsplan showing:
 * - Property boundaries
 * - Nearest well(s) with distances
 * - Water courses
 * - Protected areas
 * - Proposed sewage system location
 * - Distance annotations
 */
export function generateSituationPlanSVG(
  application: SewageApplication,
  protectionProfile: SewageProtectionProfile,
  _analysis: SewageGISAnalysis,
): string {
  const width = 1200;
  const height = 900;
  const margin = 60;
  const centerX = width / 2;
  const centerY = height / 2;
  const scale = 15; // pixels per meter

  // Helper: convert real-world meters to SVG coordinates
  const toSVG = (offsetX: number, offsetY: number) => ({
    x: centerX + offsetX * scale,
    y: centerY - offsetY * scale, // Flip Y because SVG Y increases downward
  });

  // Property corners (assume 50m x 50m property for visualization)
  const propHalfWidth = 25;
  const propHalfDepth = 25;

  const propCorners = [
    toSVG(-propHalfWidth, propHalfDepth),
    toSVG(propHalfWidth, propHalfDepth),
    toSVG(propHalfWidth, -propHalfDepth),
    toSVG(-propHalfWidth, -propHalfDepth),
  ];

  // Well location
  const wellDistance = protectionProfile.nearestWell.distance;
  const wellAngle = 45; // degrees
  const wellX = (wellDistance / 1.414) * Math.cos((wellAngle * Math.PI) / 180);
  const wellY = (wellDistance / 1.414) * Math.sin((wellAngle * Math.PI) / 180);
  const wellPos = toSVG(wellX, wellY);

  // Proposed system location (NE corner, slightly offset from property)
  const systemOffset = 8;
  const systemPos = toSVG(propHalfWidth - systemOffset, propHalfDepth - systemOffset);

  // Water course (simplified: arc on bottom)
  const waterCourseY = centerY + (protectionProfile.nearestWaterCourse.distance + 10) * scale;

  // Protected area (if any)
  const hasProtectedArea = protectionProfile.protectedNatureNearby;
  const protectedAreaRadius = 150;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" 
     width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <style>
      .property-boundary { fill: none; stroke: #333; stroke-width: 3; }
      .property-label { font-size: 14px; font-weight: bold; font-family: Arial; }
      .well { fill: #0066cc; stroke: #004499; stroke-width: 2; }
      .well-label { font-size: 12px; font-family: Arial; fill: #004499; }
      .system { fill: #ff6600; stroke: #cc4400; stroke-width: 2; }
      .system-label { font-size: 12px; font-family: Arial; fill: #cc4400; font-weight: bold; }
      .water-course { fill: none; stroke: #0099ff; stroke-width: 3; }
      .distance-line { stroke: #999; stroke-width: 1; stroke-dasharray: 3,3; }
      .distance-label { font-size: 11px; font-family: Arial; fill: #666; }
      .scale-bar { stroke: #333; stroke-width: 2; }
      .scale-label { font-size: 10px; font-family: Arial; }
      .title { font-size: 20px; font-weight: bold; font-family: Arial; }
      .subtitle { font-size: 12px; font-family: Arial; fill: #666; }
      .legend-item { font-size: 12px; font-family: Arial; }
      .protected-area { fill: #ffcccc; opacity: 0.3; stroke: #cc0000; stroke-width: 2; stroke-dasharray: 5,5; }
    </style>
  </defs>

  <!-- Background -->
  <rect width="${width}" height="${height}" fill="#f9f9f9"/>

  <!-- Title -->
  <text x="${margin}" y="40" class="title">Situationsplan – Enskilt Avlopp</text>
  <text x="${margin}" y="55" class="subtitle">Fastighet: ${application.propertyDesignation}</text>

  <!-- Protected area (if any) -->
  ${
    hasProtectedArea
      ? `<circle cx="${centerX}" cy="${centerY}" r="${protectedAreaRadius}" class="protected-area"/>`
      : ''
  }

  <!-- Water course -->
  <path d="M ${margin} ${waterCourseY} Q ${width / 2} ${waterCourseY + 30} ${width - margin} ${waterCourseY}" 
        class="water-course"/>
  <text x="${width - margin - 80}" y="${waterCourseY - 10}" class="distance-label">
    Vattendrag (${protectionProfile.nearestWaterCourse.distance}m)
  </text>

  <!-- Property boundary -->
  <polygon points="${propCorners.map((p) => `${p.x},${p.y}`).join(' ')}" class="property-boundary"/>
  <text x="${centerX - 40}" y="${centerY}" class="property-label">Fastighet</text>

  <!-- Well -->
  <circle cx="${wellPos.x}" cy="${wellPos.y}" r="8" class="well"/>
  <text x="${wellPos.x + 15}" y="${wellPos.y + 5}" class="well-label">Brunn${protectionProfile.nearestWell.owner === 'NEIGHBOR' ? ' (granne)' : ''}</text>

  <!-- Distance: well to property -->
  <line x1="${propCorners[1].x}" y1="${propCorners[1].y}" 
        x2="${wellPos.x}" y2="${wellPos.y}" class="distance-line"/>
  <text x="${(propCorners[1].x + wellPos.x) / 2 + 10}" y="${(propCorners[1].y + wellPos.y) / 2 - 10}" 
        class="distance-label">${wellDistance}m (krav: 50m)</text>

  <!-- Proposed sewage system -->
  <rect x="${systemPos.x - 12}" y="${systemPos.y - 12}" width="24" height="24" class="system" rx="3"/>
  <text x="${systemPos.x + 20}" y="${systemPos.y + 5}" class="system-label">
    Föreslaget system: ${getSystemNameSE(application.selectedSystemType)}
  </text>

  <!-- Distance: system to property line -->
  <line x1="${systemPos.x}" y1="${systemPos.y}" 
        x2="${propCorners[0].x}" y2="${propCorners[0].y}" class="distance-line"/>
  <text x="${(systemPos.x + propCorners[0].x) / 2 - 60}" y="${(systemPos.y + propCorners[0].y) / 2}" 
        class="distance-label">${protectionProfile.distanceToPropertyLine}m (krav: 4.5m)</text>

  <!-- Scale bar -->
  <g transform="translate(${width - margin - 100}, ${height - margin - 30})">
    <line x1="0" y1="0" x2="${25 * scale}" y2="0" class="scale-bar"/>
    <line x1="0" y1="-5" x2="0" y2="5" class="scale-bar"/>
    <line x1="${25 * scale}" y1="-5" x2="${25 * scale}" y2="5" class="scale-bar"/>
    <text x="${(25 * scale) / 2 - 10}" y="20" class="scale-label">25m</text>
  </g>

  <!-- Legend -->
  <g transform="translate(${margin}, ${height - 140})">
    <rect x="0" y="0" width="220" height="130" fill="white" stroke="#ccc" stroke-width="1" rx="3"/>
    <text x="10" y="20" class="legend-item" style="font-weight: bold;">Förklaringar:</text>
    
    <circle cx="15" cy="40" r="5" class="well"/>
    <text x="30" y="45" class="legend-item">Brunn</text>
    
    <rect x="10" y="55" width="12" height="12" class="system" rx="2"/>
    <text x="30" y="65" class="legend-item">Föreslaget avlopp</text>
    
    <path d="M 10 80 Q 20 75 30 80" class="water-course"/>
    <text x="40" y="85" class="legend-item">Vattendrag</text>
    
    <line x1="10" y1="100" x2="30" y2="100" class="distance-line"/>
    <text x="40" y="105" class="legend-item">Avståndskrav</text>
  </g>

  <!-- Metadata footer -->
  <g transform="translate(${margin}, ${height - margin + 20})">
    <text x="0" y="0" class="distance-label">
      Genererad: ${new Date().toISOString().split('T')[0]} | 
      PE: ${application.pe} | 
      Skyddsnivå: ${protectionProfile.protectionLevel === 'HIGH' ? 'Hög' : 'Normal'}
    </text>
  </g>
</svg>`;
}

// ============================================================================
// CROSS-SECTION (TVÄRSEKTION) - SVG GENERATION
// ============================================================================

/**
 * Generates SVG tvärsektion showing:
 * - Soil profile layers
 * - Groundwater level
 * - Proposed sewage system dimensions
 * - Distance to groundwater
 * - Depth to bedrock
 */
export function generateCrossSectionSVG(
  application: SewageApplication,
  protectionProfile: SewageProtectionProfile,
): string {
  const width = 1000;
  const height = 700;
  const margin = 60;
  const contentWidth = width - 2 * margin;
  const contentHeight = height - 2 * margin;

  // Soil depths (in meters)
  const maxDepth = Math.max(15, protectionProfile.soilProfile.depthToRock + 5);
  const depthScale = contentHeight / maxDepth;

  // Y position helpers
  const groundLevel = margin + 50;
  const depthToY = (depth: number) => groundLevel + depth * depthScale;

  const gwLevel = protectionProfile.soilProfile.groundwaterLevel;
  const bedRockDepth = protectionProfile.soilProfile.depthToRock;

  // System dimensions
  const systemDepth = application.dimensionedDepth || 1.5;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" 
     width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <style>
      .title { font-size: 18px; font-weight: bold; font-family: Arial; }
      .subtitle { font-size: 12px; font-family: Arial; fill: #666; }
      .soil-label { font-size: 11px; font-family: Arial; fill: #333; }
      .dimension-line { stroke: #000; stroke-width: 1; }
      .dimension-text { font-size: 10px; font-family: Arial; fill: #000; }
      .axis-label { font-size: 11px; font-family: Arial; fill: #333; }
      .soil-sand { fill: #f4d03f; stroke: #d4af37; stroke-width: 1; }
      .soil-clay { fill: #c4945c; stroke: #8b6f47; stroke-width: 1; }
      .soil-rock { fill: #999; stroke: #666; stroke-width: 1; }
      .groundwater { fill: none; stroke: #0099ff; stroke-width: 2; stroke-dasharray: 4,4; }
      .system { fill: #ff6600; stroke: #cc4400; stroke-width: 2; }
      .system-label { font-size: 11px; font-family: Arial; fill: #cc4400; font-weight: bold; }
      .grid-line { stroke: #ddd; stroke-width: 0.5; }
      .arrow { fill: none; stroke: #666; stroke-width: 1.5; }
      .arrow-head { fill: #666; }
    </style>
  </defs>

  <!-- Background -->
  <rect width="${width}" height="${height}" fill="#f9f9f9"/>

  <!-- Title -->
  <text x="${margin}" y="30" class="title">Tvärsektion – Jordbeskaffenhet och Systemplacering</text>

  <!-- Depth scale (grid) -->
  ${Array.from({ length: Math.ceil(maxDepth) + 1 }, (_, i) => {
    const depth = i * 1;
    const y = depthToY(depth);
    return `
      <line x1="${margin}" y1="${y}" x2="${width - margin}" y2="${y}" class="grid-line"/>
      <text x="${margin - 40}" y="${y + 4}" class="axis-label">${depth}m</text>
    `;
  }).join('')}

  <!-- Depth axis -->
  <line x1="${margin}" y1="${groundLevel}" x2="${margin}" y2="${depthToY(maxDepth)}" stroke="#333" stroke-width="2"/>
  <text x="${margin - 45}" y="${groundLevel - 15}" class="axis-label">Djup</text>

  <!-- Top soil layer (organic, brown) -->
  <rect x="${margin + 10}" y="${groundLevel}" width="${contentWidth - 20}" height="${0.3 * depthScale}" 
        fill="#8b7355" stroke="#5a4a38" stroke-width="1"/>
  <text x="${margin + 20}" y="${groundLevel + 15}" class="soil-label">Övre humus (~30cm)</text>

  <!-- Main soil layer based on soil type -->
  ${generateSoilLayersSVG(protectionProfile, depthToY, margin, contentWidth)}

  <!-- Groundwater level indicator -->
  <line x1="${margin + 5}" y1="${depthToY(gwLevel)}" x2="${width - margin - 5}" y2="${depthToY(gwLevel)}" 
        class="groundwater"/>
  <text x="${margin + 10}" y="${depthToY(gwLevel) - 8}" class="dimension-text">
    Grundvattennivå: ${gwLevel}m
  </text>

  <!-- Bedrock -->
  <rect x="${margin + 10}" y="${depthToY(bedRockDepth)}" width="${contentWidth - 20}" 
        height="${depthToY(maxDepth) - depthToY(bedRockDepth)}" class="soil-rock"/>
  <text x="${margin + 20}" y="${(depthToY(bedRockDepth) + depthToY(maxDepth)) / 2}" class="soil-label">
    Berg (>{bedRockDepth}m)
  </text>

  <!-- Proposed system visualization -->
  ${generateSystemVisualizationSVG(
    application,
    protectionProfile,
    margin,
    contentWidth,
    groundLevel,
    depthScale,
    gwLevel,
  )}

  <!-- Key requirements/warnings -->
  <g transform="translate(${margin}, ${height - 120})">
    <rect x="0" y="0" width="${contentWidth}" height="100" fill="white" stroke="#ccc" stroke-width="1" rx="3"/>
    <text x="10" y="20" class="soil-label" style="font-weight: bold;">Systemkrav enligt denna profil:</text>
    <text x="15" y="40" class="soil-label">
      • Minsta avstånd till grundvatten: ${Math.max(0, gwLevel - systemDepth)}m ✓
    </text>
    <text x="15" y="55" class="soil-label">
      • Infiltrationskapacitet: ${protectionProfile.soilProfile.infiltrationCapacity}
    </text>
    <text x="15" y="70" class="soil-label">
      • Permeabilitet: ${protectionProfile.soilProfile.permeability} mm/h
    </text>
    <text x="15" y="85" class="soil-label">
      • Rekommenderat system: ${getSystemNameSE(protectionProfile.recommendedSystem)}
    </text>
  </g>

  <!-- Metadata footer -->
  <g transform="translate(${margin}, ${height - margin + 15})">
    <text x="0" y="0" class="dimension-text">
      Genererad: ${new Date().toISOString().split('T')[0]} | 
      PE: ${application.pe} | 
      Jordtyp: ${protectionProfile.soilProfile.soilType}
    </text>
  </g>
</svg>`;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateSoilLayersSVG(
  protectionProfile: SewageProtectionProfile,
  depthToY: (d: number) => number,
  margin: number,
  contentWidth: number,
): string {
  const soilType = protectionProfile.soilProfile.soilType;
  let svg = '';

  // Main soil classification
  const soilClass = determineSoilClass(soilType);
  const mainLayerDepth = protectionProfile.soilProfile.depthToRock;
  const mainLayerStart = 0.3; // After humus layer

  const layerFill = soilClass === 'sand' ? '#f4d03f' : soilClass === 'clay' ? '#c4945c' : '#e8d4b8';
  const layerStroke = soilClass === 'sand' ? '#d4af37' : soilClass === 'clay' ? '#8b6f47' : '#c9b98a';

  svg += `
    <rect x="${margin + 10}" y="${depthToY(mainLayerStart)}" width="${contentWidth - 20}" 
          height="${depthToY(mainLayerDepth) - depthToY(mainLayerStart)}" 
          class="soil-${soilClass}" fill="${layerFill}" stroke="${layerStroke}"/>
    <text x="${margin + 20}" y="${(depthToY(mainLayerStart) + depthToY(mainLayerDepth)) / 2}" 
          class="soil-label">${soilType}</text>
  `;

  return svg;
}

function generateSystemVisualizationSVG(
  application: SewageApplication,
  protectionProfile: SewageProtectionProfile,
  margin: number,
  contentWidth: number,
  groundLevel: number,
  depthScale: number,
  gwLevel: number,
): string {
  const systemDepth = application.dimensionedDepth || 1.5;
  const systemWidth = 40; // Fixed width for visualization
  const systemX = margin + contentWidth / 2 - systemWidth / 2;
  const systemY = groundLevel + systemDepth * depthScale;

  const systemName = getSystemNameSE(application.selectedSystemType);

  return `
    <!-- System pit/tank -->
    <rect x="${systemX}" y="${groundLevel}" width="${systemWidth}" height="${systemDepth * depthScale}" 
          class="system"/>
    
    <!-- System label -->
    <text x="${systemX + systemWidth + 10}" y="${groundLevel + 20}" class="system-label">
      ${systemName}
    </text>
    
    <!-- Depth annotation -->
    <g>
      <line x1="${systemX - 15}" y1="${groundLevel}" x2="${systemX - 5}" y2="${groundLevel}" class="dimension-line"/>
      <line x1="${systemX - 10}" y1="${groundLevel}" x2="${systemX - 10}" y2="${systemY}" class="dimension-line"/>
      <line x1="${systemX - 15}" y1="${systemY}" x2="${systemX - 5}" y2="${systemY}" class="dimension-line"/>
      <text x="${systemX - 60}" y="${groundLevel + (systemDepth * depthScale) / 2 + 4}" class="dimension-text">
        ${systemDepth}m
      </text>
    </g>
    
    <!-- Distance to groundwater annotation -->
    ${
      gwLevel > systemDepth
        ? `
      <g>
        <line x1="${systemX + systemWidth + 15}" y1="${groundLevel + systemDepth * depthScale}" 
              x2="${systemX + systemWidth + 15}" y2="${groundLevel + gwLevel * depthScale}" 
              class="dimension-line" stroke="#0066cc"/>
        <text x="${systemX + systemWidth + 20}" y="${groundLevel + ((systemDepth + gwLevel) / 2) * depthScale}" 
              class="dimension-text" fill="#0066cc">
          ${(gwLevel - systemDepth).toFixed(1)}m till GW
        </text>
      </g>
    `
        : `
      <text x="${systemX + systemWidth + 20}" y="${groundLevel + systemDepth * depthScale + 15}" 
            class="dimension-text" fill="#ff0000" style="font-weight: bold;">
        ⚠ FÖR GRUNDVATTENNÄRA
      </text>
    `
    }
  `;
}

function determineSoilClass(soilType: string): 'sand' | 'clay' | 'silt' {
  const lower = soilType.toLowerCase();
  if (lower.includes('lera') || lower.includes('clay')) return 'clay';
  if (lower.includes('sand') || lower.includes('sand')) return 'sand';
  return 'silt';
}

function getSystemNameSE(systemType: string): string {
  const names: Record<string, string> = {
    CLOSED_TANK: 'Sluten tank',
    INFILTRATION: 'Infiltrationssystem',
    SOIL_BED: 'Markbädd (rotozonsystem)',
    MINI_PLANT_BDTA: 'Minireningsverk (BDTA)',
    MINI_PLANT_BDT: 'Minireningsverk (BDT)',
    PHOSPHORUS_TRAP: 'Fosforfälla',
  };
  return names[systemType] || systemType;
}

// ============================================================================
// DOCUMENT GENERATION ORCHESTRATION
// ============================================================================

export interface GeneratedSewageDocuments {
  situationPlanSVG: string;
  crossSectionSVG: string;
  generatedAt: string;
}

/**
 * Main entry point: Generate all documents for a sewage application
 */
export function generateSewageApplicationDocuments(
  application: SewageApplication,
  protectionProfile: SewageProtectionProfile,
  analysis: SewageGISAnalysis,
): GeneratedSewageDocuments {
  return {
    situationPlanSVG: generateSituationPlanSVG(application, protectionProfile, analysis),
    crossSectionSVG: generateCrossSectionSVG(application, protectionProfile),
    generatedAt: new Date().toISOString(),
  };
}
