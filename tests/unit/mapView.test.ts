import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import MapView from '../../components/MapView';

describe('MapView', () => {
  it('renders all public and myndighetslager toggles in the UI shell', () => {
    const html = renderToStaticMarkup(React.createElement(MapView));

    const expectedLabels = [
      'RAA lamningar',
      'Natura 2000 (NV)',
      'Naturreservat (NV)',
      'Oversvamningsrisk (MSB)',
      'SGU jordart WMS',
      'SGU grundlager (PostGIS)',
      'SGU jordskred/raviner',
      'Trafikverket',
      'NVR (PostGIS DB)',
      'Sjöar (PostGIS DB)',
      'Vattendrag (PostGIS DB)',
      'Fastighetsgränser (PostGIS)',
      'Lantm. Fastighetskarta',
      'NMD Bas (NV)',
      'Produktivitet (NMD)',
      'Nyckelbiotoper (SKS)',
      'Avverkningsanmälan',
      'Markfuktighet (DTW)',
    ];

    for (const label of expectedLabels) {
      expect(html).toContain(label);
    }
  });
});
