// src/infrastructure/geo/static-map-generator.ts

import { prisma } from '../../../server/db/prisma';
import { Logger } from '../observability/logger';

const logger = new Logger('StaticMapGenerator');

export interface StaticMapOptions {
  width?: number;
  height?: number;
  padding?: number;
}

export interface MapLayer {
  layerName: string;
  displayName: string;
  color: string;
  strokeColor: string;
  fillOpacity: number;
  strokeWidth: number;
  geometries: any[]; // Array of GeoJSON geometries
}

export interface StaticMapResult {
  svg: string;
  propertyDesignation: string;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  intersectingZones: string[];
}

/**
 * Genererar en premium statisk SVG-kartbild direkt från PostGIS-geometrier.
 * Hämtar fastighetsgränser, Natura 2000, skyddsområden och omgivande byggnader.
 */
export class StaticMapGenerator {
  async generateMap(
    designation: string,
    options: StaticMapOptions = {}
  ): Promise<StaticMapResult> {
    const width = options.width ?? 600;
    const height = options.height ?? 400;
    const padding = options.padding ?? 40;

    logger.info(`Genererar statisk karta för fastighet: ${designation}`);

    // 1. Hämta fastighetens geometri och dess bounding box från core.property_unit
    const propertyQuery = await prisma.$queryRaw<any[]>`
      SELECT 
        designation, 
        ST_AsGeoJSON(geom) as geojson, 
        ST_XMin(geom) as min_x, 
        ST_YMin(geom) as min_y, 
        ST_XMax(geom) as max_x, 
        ST_YMax(geom) as max_y
      FROM core.property_unit
      WHERE designation_norm = core.normalize_designation(${designation})
         OR designation ILIKE ${designation}
      LIMIT 1;
    `;

    if (!propertyQuery || propertyQuery.length === 0) {
      throw new Error(`Kunde inte hitta fastighet med beteckning: ${designation}`);
    }

    const prop = propertyQuery[0];
    const propertyDesignation = prop.designation;
    const propGeom = JSON.parse(prop.geojson);

    let minX = prop.min_x;
    let minY = prop.min_y;
    let maxX = prop.max_x;
    let maxY = prop.max_y;

    // Lägg till 25% padding till kartans geobounds för att visa omgivning
    const mapWidthGeo = maxX - minX;
    const mapHeightGeo = maxY - minY;
    const geoPaddingX = Math.max(50, mapWidthGeo * 0.25);
    const geoPaddingY = Math.max(50, mapHeightGeo * 0.25);

    minX -= geoPaddingX;
    maxX += geoPaddingX;
    minY -= geoPaddingY;
    maxY += geoPaddingY;

    // Definiera bounding box polygon för spatiala intersects
    const bboxWkt = `SRID=3006;POLYGON((${minX} ${minY}, ${minX} ${maxY}, ${maxX} ${maxY}, ${maxX} ${minY}, ${minX} ${minY}))`;

    // Förbered lager-samling
    const layers: MapLayer[] = [];
    const intersectingZones: string[] = [];

    // 2. Hämta omgivande byggnader från topo10.byggnad
    try {
      const buildings = await prisma.$queryRaw<any[]>`
        SELECT ST_AsGeoJSON(geom) as geojson
        FROM topo10.byggnad
        WHERE ST_Intersects(geom, ST_GeomFromText(${bboxWkt}))
        LIMIT 150;
      `;
      if (buildings && buildings.length > 0) {
        layers.push({
          layerName: 'byggnad',
          displayName: 'Byggnader',
          color: '#D4B59D',
          strokeColor: '#A08070',
          fillOpacity: 0.85,
          strokeWidth: 0.5,
          geometries: buildings.map(b => JSON.parse(b.geojson)),
        });
      }
    } catch (err: any) {
      logger.warn(`Kunde inte hämta byggnader: ${err.message}`);
    }

    // 3. Hämta Natura 2000-områden som skär vår bounding box
    try {
      const natura2000 = await prisma.$queryRaw<any[]>`
        SELECT site_name as name, ST_AsGeoJSON(wkb_geometry) as geojson
        FROM env.natura2000_area
        WHERE ST_Intersects(wkb_geometry, ST_GeomFromText(${bboxWkt}))
        LIMIT 10;
      `;
      if (natura2000 && natura2000.length > 0) {
        natura2000.forEach(n => intersectingZones.push(`Natura 2000: ${n.name}`));
        layers.push({
          layerName: 'natura2000',
          displayName: 'Natura 2000',
          color: '#E8C070',
          strokeColor: '#D89E3F',
          fillOpacity: 0.35,
          strokeWidth: 1.2,
          geometries: natura2000.map(n => JSON.parse(n.geojson)),
        });
      }
    } catch (err: any) {
      logger.warn(`Kunde inte hämta Natura 2000: ${err.message}`);
    }

    // 4. Hämta skyddsområden (naturreservat etc) från env.protected_area
    try {
      const protectedAreas = await prisma.$queryRaw<any[]>`
        SELECT name, ST_AsGeoJSON(geom) as geojson
        FROM env.protected_area
        WHERE ST_Intersects(geom, ST_GeomFromText(${bboxWkt}))
        LIMIT 10;
      `;
      if (protectedAreas && protectedAreas.length > 0) {
        protectedAreas.forEach(p => intersectingZones.push(`Skyddat område: ${p.name}`));
        layers.push({
          layerName: 'protected_area',
          displayName: 'Skyddat område',
          color: '#CDE5B6',
          strokeColor: '#80B918',
          fillOpacity: 0.3,
          strokeWidth: 1.0,
          geometries: protectedAreas.map(p => JSON.parse(p.geojson)),
        });
      }
    } catch (err: any) {
      logger.warn(`Kunde inte hämta skyddsområden: ${err.message}`);
    }

    // 5. Hämta vattenskyddsområden från env.water_protection_area
    try {
      const waterProtection = await prisma.$queryRaw<any[]>`
        SELECT namn as name, ST_AsGeoJSON(wkb_geometry) as geojson
        FROM env.water_protection_area
        WHERE ST_Intersects(wkb_geometry, ST_GeomFromText(${bboxWkt}))
        LIMIT 10;
      `;
      if (waterProtection && waterProtection.length > 0) {
        waterProtection.forEach(w => intersectingZones.push(`Vattenskyddsområde: ${w.name}`));
        layers.push({
          layerName: 'water_protection',
          displayName: 'Vattenskyddsområde',
          color: '#A9D6E5',
          strokeColor: '#014F86',
          fillOpacity: 0.35,
          strokeWidth: 1.2,
          geometries: waterProtection.map(w => JSON.parse(w.geojson)),
        });
      }
    } catch (err: any) {
      logger.warn(`Kunde inte hämta vattenskyddsområden: ${err.message}`);
    }

    // 6. Lägg till själva fastigheten överst på kartan
    layers.push({
      layerName: 'property',
      displayName: 'Fastighet',
      color: '#A7C957',
      strokeColor: '#386641',
      fillOpacity: 0.4,
      strokeWidth: 2.0,
      geometries: [propGeom],
    });

    // 7. Beräkna skalning och projektion från SWEREF99 TM till SVG-bildkoordinater
    const geoWidth = maxX - minX;
    const geoHeight = maxY - minY;
    const targetWidth = width - 2 * padding;
    const targetHeight = height - 2 * padding;

    const geoRatio = geoWidth / geoHeight;
    const targetRatio = targetWidth / targetHeight;

    let scale: number;
    let offsetX: number;
    let offsetY: number;

    if (geoRatio > targetRatio) {
      scale = targetWidth / geoWidth;
      offsetX = padding;
      offsetY = padding + (targetHeight - geoHeight * scale) / 2;
    } else {
      scale = targetHeight / geoHeight;
      offsetX = padding + (targetWidth - geoWidth * scale) / 2;
      offsetY = padding;
    }

    function project(x: number, y: number): [number, number] {
      const X = offsetX + (x - minX) * scale;
      const Y = height - (offsetY + (y - minY) * scale); // Invertera Y eftersom SVG nollpunkt är uppe till vänster
      return [
        Math.round(X * 100) / 100,
        Math.round(Y * 100) / 100
      ];
    }

    // 8. Generera SVG Path-strängar för varje geometri
    let svgPaths = '';

    for (const layer of layers) {
      svgPaths += `  <!-- Layer: ${layer.displayName} -->\n`;
      svgPaths += `  <g id="layer-${layer.layerName}" fill="${layer.color}" fill-opacity="${layer.fillOpacity}" stroke="${layer.strokeColor}" stroke-width="${layer.strokeWidth}">\n`;

      for (const geom of layer.geometries) {
        if (!geom) continue;

        if (geom.type === 'Polygon') {
          const pathData = this.polygonToPath(geom.coordinates, project);
          svgPaths += `    <path d="${pathData}" />\n`;
        } else if (geom.type === 'MultiPolygon') {
          geom.coordinates.forEach((polyCoords: any) => {
            const pathData = this.polygonToPath(polyCoords, project);
            svgPaths += `    <path d="${pathData}" />\n`;
          });
        }
      }

      svgPaths += `  </g>\n`;
    }

    // 9. Skapa teckenförklaring (Legend)
    let legendSvg = `  <!-- Legend -->\n  <g id="legend" transform="translate(15, 15)">\n`;
    legendSvg += `    <rect x="0" y="0" width="180" height="${layers.length * 20 + 10}" fill="#FFFFFF" fill-opacity="0.9" stroke="#CCCCCC" stroke-width="1" rx="4" />\n`;
    
    layers.forEach((layer, idx) => {
      const y = idx * 20 + 15;
      legendSvg += `    <rect x="10" y="${y - 8}" width="16" height="10" fill="${layer.color}" fill-opacity="${layer.fillOpacity === 0 ? 0 : 0.8}" stroke="${layer.strokeColor}" stroke-width="${layer.strokeWidth}" />\n`;
      legendSvg += `    <text x="35" y="${y}" font-family="'Helvetica Neue', Inter, Arial" font-size="10" fill="#333333" font-weight="bold">${layer.displayName}</text>\n`;
    });
    legendSvg += `  </g>\n`;

    // 10. Lägg till skalstock (Scale Bar)
    const scaleLengthGeo = Math.round(geoWidth * 0.25); // ca 25% av kartbredden
    const scaleLengthPixels = scaleLengthGeo * scale;
    const roundedScaleGeo = this.roundToNiceNumber(scaleLengthGeo);
    const roundedScalePixels = roundedScaleGeo * scale;

    let scaleBarSvg = `  <!-- Scale Bar -->\n  <g id="scale-bar" transform="translate(${width - roundedScalePixels - 25}, ${height - 25})">\n`;
    scaleBarSvg += `    <rect x="-5" y="-12" width="${roundedScalePixels + 10}" height="18" fill="#FFFFFF" fill-opacity="0.8" rx="2" />\n`;
    scaleBarSvg += `    <line x1="0" y1="0" x2="${roundedScalePixels}" y2="0" stroke="#333333" stroke-width="2" />\n`;
    scaleBarSvg += `    <line x1="0" y1="-3" x2="0" y2="3" stroke="#333333" stroke-width="2" />\n`;
    scaleBarSvg += `    <line x1="${roundedScalePixels}" y1="-3" x2="${roundedScalePixels}" y2="3" stroke="#333333" stroke-width="2" />\n`;
    scaleBarSvg += `    <text x="${roundedScalePixels / 2}" y="-5" font-family="'Helvetica Neue', Inter, Arial" font-size="9" fill="#333333" font-weight="bold" text-anchor="middle">${roundedScaleGeo} m</text>\n`;
    scaleBarSvg += `  </g>\n`;

    // 11. Skapa det fullständiga SVG-dokumentet med norrpil och ram
    const fullSvg = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <!-- Bakgrund -->
  <rect width="100%" height="100%" fill="#F8F9FA" stroke="#CCCCCC" stroke-width="1.5" />
  
  <!-- Rutmönster (Grid) -->
  <defs>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#E5E5E5" stroke-width="0.5" />
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#grid)" />

  <!-- Kartlager -->
${svgPaths}
${legendSvg}
${scaleBarSvg}
  <!-- Norrpil -->
  <g id="north-arrow" transform="translate(${width - 30}, 35)">
    <circle cx="0" cy="0" r="14" fill="#FFFFFF" fill-opacity="0.9" stroke="#CCCCCC" stroke-width="1" />
    <path d="M 0 -10 L 4 3 L 0 1 L -4 3 Z" fill="#333333" />
    <text x="0" y="-12" font-family="'Helvetica Neue', Inter, Arial" font-size="8" fill="#333333" font-weight="bold" text-anchor="middle">N</text>
  </g>
</svg>`;

    return {
      svg: fullSvg,
      propertyDesignation,
      bbox: { minX, minY, maxX, maxY },
      intersectingZones,
    };
  }

  /**
   * Ritar kartan direkt som vektorgrafik i ett PDFKit-dokument.
   * Säkerställer 100% offline-tålighet och pixel-perfekt upplösning.
   */
  async drawMapToPdf(
    doc: any,
    designation: string,
    x: number,
    y: number,
    width: number,
    height: number,
    padding = 40
  ): Promise<string[]> {
    logger.info(`Ritar statisk PDF-karta för fastighet: ${designation}`);

    // 1. Hämta fastighetens geometri och dess bounding box från core.property_unit
    const propertyQuery = await prisma.$queryRaw<any[]>`
      SELECT 
        designation, 
        ST_AsGeoJSON(geom) as geojson, 
        ST_XMin(geom) as min_x, 
        ST_YMin(geom) as min_y, 
        ST_XMax(geom) as max_x, 
        ST_YMax(geom) as max_y
      FROM core.property_unit
      WHERE designation_norm = core.normalize_designation(${designation})
         OR designation ILIKE ${designation}
      LIMIT 1;
    `;

    if (!propertyQuery || propertyQuery.length === 0) {
      throw new Error(`Kunde inte hitta fastighet med beteckning: ${designation}`);
    }

    const prop = propertyQuery[0];
    const propGeom = JSON.parse(prop.geojson);

    let minX = prop.min_x;
    let minY = prop.min_y;
    let maxX = prop.max_x;
    let maxY = prop.max_y;

    const mapWidthGeo = maxX - minX;
    const mapHeightGeo = maxY - minY;
    const geoPaddingX = Math.max(50, mapWidthGeo * 0.25);
    const geoPaddingY = Math.max(50, mapHeightGeo * 0.25);

    minX -= geoPaddingX;
    maxX += geoPaddingX;
    minY -= geoPaddingY;
    maxY += geoPaddingY;

    const bboxWkt = `SRID=3006;POLYGON((${minX} ${minY}, ${minX} ${maxY}, ${maxX} ${maxY}, ${maxX} ${minY}, ${minX} ${minY}))`;

    const layers: MapLayer[] = [];
    const intersectingZones: string[] = [];

    // 2. Hämta omgivande byggnader från topo10.byggnad
    try {
      const buildings = await prisma.$queryRaw<any[]>`
        SELECT ST_AsGeoJSON(geom) as geojson
        FROM topo10.byggnad
        WHERE ST_Intersects(geom, ST_GeomFromText(${bboxWkt}))
        LIMIT 150;
      `;
      if (buildings && buildings.length > 0) {
        layers.push({
          layerName: 'byggnad',
          displayName: 'Byggnader',
          color: '#D4B59D',
          strokeColor: '#A08070',
          fillOpacity: 0.85,
          strokeWidth: 0.5,
          geometries: buildings.map(b => JSON.parse(b.geojson)),
        });
      }
    } catch (err: any) {
      logger.warn(`Kunde inte hämta byggnader: ${err.message}`);
    }

    // 3. Hämta Natura 2000-områden
    try {
      const natura2000 = await prisma.$queryRaw<any[]>`
        SELECT site_name as name, ST_AsGeoJSON(wkb_geometry) as geojson
        FROM env.natura2000_area
        WHERE ST_Intersects(wkb_geometry, ST_GeomFromText(${bboxWkt}))
        LIMIT 10;
      `;
      if (natura2000 && natura2000.length > 0) {
        natura2000.forEach(n => intersectingZones.push(`Natura 2000: ${n.name}`));
        layers.push({
          layerName: 'natura2000',
          displayName: 'Natura 2000',
          color: '#E8C070',
          strokeColor: '#D89E3F',
          fillOpacity: 0.35,
          strokeWidth: 1.2,
          geometries: natura2000.map(n => JSON.parse(n.geojson)),
        });
      }
    } catch (err: any) {
      logger.warn(`Kunde inte hämta Natura 2000: ${err.message}`);
    }

    // 4. Hämta skyddsområden
    try {
      const protectedAreas = await prisma.$queryRaw<any[]>`
        SELECT name, ST_AsGeoJSON(geom) as geojson
        FROM env.protected_area
        WHERE ST_Intersects(geom, ST_GeomFromText(${bboxWkt}))
        LIMIT 10;
      `;
      if (protectedAreas && protectedAreas.length > 0) {
        protectedAreas.forEach(p => intersectingZones.push(`Skyddat område: ${p.name}`));
        layers.push({
          layerName: 'protected_area',
          displayName: 'Skyddat område',
          color: '#CDE5B6',
          strokeColor: '#80B918',
          fillOpacity: 0.3,
          strokeWidth: 1.0,
          geometries: protectedAreas.map(p => JSON.parse(p.geojson)),
        });
      }
    } catch (err: any) {
      logger.warn(`Kunde inte hämta skyddsområden: ${err.message}`);
    }

    // 5. Hämta vattenskyddsområden
    try {
      const waterProtection = await prisma.$queryRaw<any[]>`
        SELECT namn as name, ST_AsGeoJSON(wkb_geometry) as geojson
        FROM env.water_protection_area
        WHERE ST_Intersects(wkb_geometry, ST_GeomFromText(${bboxWkt}))
        LIMIT 10;
      `;
      if (waterProtection && waterProtection.length > 0) {
        waterProtection.forEach(w => intersectingZones.push(`Vattenskyddsområde: ${w.name}`));
        layers.push({
          layerName: 'water_protection',
          displayName: 'Vattenskyddsområde',
          color: '#A9D6E5',
          strokeColor: '#014F86',
          fillOpacity: 0.35,
          strokeWidth: 1.2,
          geometries: waterProtection.map(w => JSON.parse(w.geojson)),
        });
      }
    } catch (err: any) {
      logger.warn(`Kunde inte hämta vattenskyddsområden: ${err.message}`);
    }

    // 6. Lägg till själva fastigheten överst
    layers.push({
      layerName: 'property',
      displayName: 'Fastighet',
      color: '#A7C957',
      strokeColor: '#386641',
      fillOpacity: 0.4,
      strokeWidth: 2.0,
      geometries: [propGeom],
    });

    // 7. Skalning och projektion
    const geoWidth = maxX - minX;
    const geoHeight = maxY - minY;
    const targetWidth = width - 2 * padding;
    const targetHeight = height - 2 * padding;

    const geoRatio = geoWidth / geoHeight;
    const targetRatio = targetWidth / targetHeight;

    let scale: number;
    let offsetX: number;
    let offsetY: number;

    if (geoRatio > targetRatio) {
      scale = targetWidth / geoWidth;
      offsetX = padding;
      offsetY = padding + (targetHeight - geoHeight * scale) / 2;
    } else {
      scale = targetHeight / geoHeight;
      offsetX = padding + (targetWidth - geoWidth * scale) / 2;
      offsetY = padding;
    }

    const project = (xCoord: number, yCoord: number): [number, number] => {
      const X = x + offsetX + (xCoord - minX) * scale;
      const Y = y + height - (offsetY + (yCoord - minY) * scale); // Invertera Y
      return [
        Math.round(X * 100) / 100,
        Math.round(Y * 100) / 100
      ];
    };

    // 8. Rita kartramen och bakgrunden i PDFKit
    doc.save();
    doc.rect(x, y, width, height).fillColor('#F8F9FA').strokeColor('#CCCCCC').lineWidth(1.5).fillAndStroke();

    // Rita rutmönster (Grid) i PDFKit
    doc.save();
    doc.strokeColor('#E5E5E5').lineWidth(0.5);
    for (let gx = x + 40; gx < x + width; gx += 40) {
      doc.moveTo(gx, y).lineTo(gx, y + height).stroke();
    }
    for (let gy = y + 40; gy < y + height; gy += 40) {
      doc.moveTo(x, gy).lineTo(x + width, gy).stroke();
    }
    doc.restore();

    // 9. Rita kartlager
    for (const layer of layers) {
      for (const geom of layer.geometries) {
        if (!geom) continue;

        doc.save();
        if (layer.fillOpacity > 0 && layer.color) {
          doc.fillColor(layer.color).fillOpacity(layer.fillOpacity);
        }
        if (layer.strokeWidth > 0 && layer.strokeColor) {
          doc.strokeColor(layer.strokeColor).lineWidth(layer.strokeWidth).strokeOpacity(1);
        }

        if (geom.type === 'Polygon') {
          const pathData = this.polygonToPath(geom.coordinates, project);
          doc.path(pathData);
          if (layer.fillOpacity > 0 && layer.color && layer.strokeWidth > 0 && layer.strokeColor) {
            doc.fillAndStroke();
          } else if (layer.fillOpacity > 0 && layer.color) {
            doc.fill();
          } else {
            doc.stroke();
          }
        } else if (geom.type === 'MultiPolygon') {
          geom.coordinates.forEach((polyCoords: any) => {
            const pathData = this.polygonToPath(polyCoords, project);
            doc.path(pathData);
            if (layer.fillOpacity > 0 && layer.color && layer.strokeWidth > 0 && layer.strokeColor) {
              doc.fillAndStroke();
            } else if (layer.fillOpacity > 0 && layer.color) {
              doc.fill();
            } else {
              doc.stroke();
            }
          });
        }
        doc.restore();
      }
    }

    // 10. Teckenförklaring (Legend)
    doc.save();
    const legendW = 150;
    const legendH = layers.length * 16 + 10;
    doc.rect(x + 10, y + 10, legendW, legendH).fillColor('#FFFFFF').fillOpacity(0.9).strokeColor('#CCCCCC').lineWidth(1).fillAndStroke();
    
    layers.forEach((layer, idx) => {
      const ly = y + 10 + idx * 16 + 12;
      doc.save();
      doc.rect(x + 18, ly - 6, 12, 8).fillColor(layer.color).fillOpacity(layer.fillOpacity === 0 ? 0 : 0.8).strokeColor(layer.strokeColor).lineWidth(layer.strokeWidth).fillAndStroke();
      doc.restore();

      doc.fillColor('#333333').fontSize(8).text(layer.displayName, x + 36, ly - 7, { lineBreak: false });
    });
    doc.restore();

    // 11. Skalstock (Scale Bar)
    const scaleLengthGeo = Math.round(geoWidth * 0.25);
    const roundedScaleGeo = this.roundToNiceNumber(scaleLengthGeo);
    const roundedScalePixels = roundedScaleGeo * scale;

    const scaleBarX = x + width - roundedScalePixels - 20;
    const scaleBarY = y + height - 20;

    doc.save();
    doc.rect(scaleBarX - 5, scaleBarY - 12, roundedScalePixels + 10, 16).fillColor('#FFFFFF').fillOpacity(0.8).fill();
    doc.moveTo(scaleBarX, scaleBarY).lineTo(scaleBarX + roundedScalePixels, scaleBarY).strokeColor('#333333').lineWidth(1.5).stroke();
    doc.moveTo(scaleBarX, scaleBarY - 3).lineTo(scaleBarX, scaleBarY + 3).stroke();
    doc.moveTo(scaleBarX + roundedScalePixels, scaleBarY - 3).lineTo(scaleBarX + roundedScalePixels, scaleBarY + 3).stroke();
    doc.fillColor('#333333').fontSize(8).text(`${roundedScaleGeo} m`, scaleBarX, scaleBarY - 11, { width: roundedScalePixels, align: 'center' });
    doc.restore();

    // 12. Norrpil
    const arrowX = x + width - 25;
    const arrowY = y + 25;
    doc.save();
    doc.circle(arrowX, arrowY, 11).fillColor('#FFFFFF').fillOpacity(0.9).strokeColor('#CCCCCC').lineWidth(1).fillAndStroke();
    doc.path(`M ${arrowX} ${arrowY - 8} L ${arrowX + 3} ${arrowY + 2} L ${arrowX} ${arrowY + 1} L ${arrowX - 3} ${arrowY + 2} Z`).fillColor('#333333').fill();
    doc.fillColor('#333333').fontSize(7).text('N', arrowX - 5, arrowY - 18, { width: 10, align: 'center' });
    doc.restore();

    doc.restore(); // återställ huvuddokument-tillståndet

    return intersectingZones;
  }

  private polygonToPath(
    coordinates: any[][],
    project: (x: number, y: number) => [number, number]
  ): string {
    let path = '';
    coordinates.forEach((ring) => {
      if (ring.length === 0) return;
      const start = project(ring[0][0], ring[0][1]);
      path += `M ${start[0]} ${start[1]}`;
      for (let i = 1; i < ring.length; i++) {
        const pt = project(ring[i][0], ring[i][1]);
        path += ` L ${pt[0]} ${pt[1]}`;
      }
      path += ' Z ';
    });
    return path.trim();
  }

  private roundToNiceNumber(num: number): number {
    const power = Math.pow(10, Math.floor(Math.log10(num)));
    const ratio = num / power;
    let niceRatio = 1;
    if (ratio >= 5) niceRatio = 5;
    else if (ratio >= 2) niceRatio = 2;
    return niceRatio * power;
  }
}
