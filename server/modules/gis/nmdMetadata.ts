export const NMD_CLASS_MAP: Record<number, string> = {
  3: 'Åkermark',
  23: 'Låg fjällskog på våtmark',
  43: 'Låg fjällskog på fastmark',
  51: 'Exploaterad mark, byggnad',
  52: 'Exploaterad mark, ej byggnad eller väg/järnväg',
  53: 'Exploaterad mark, väg/järnväg',
  54: 'Exploaterad mark, torvtäkt',
  61: 'Sjö och vattendrag',
  62: 'Hav',
  111: 'Tallskog på fastmark',
  112: 'Granskog på fastmark',
  113: 'Barrblandskog på fastmark',
  114: 'Lövblandad barrskog på fastmark',
  115: 'Triviallövskog på fastmark',
  116: 'Ädellövskog på fastmark',
  117: 'Triviallövskog med ädellövinslag på fastmark',
  118: 'Temporärt ej skog på fastmark (hygge/ungskog)',
  121: 'Tallskog på våtmark',
  122: 'Granskog på våtmark',
  123: 'Barrblandskog på våtmark',
  124: 'Lövblandad barrskog på våtmark',
  125: 'Triviallövskog på våtmark',
  126: 'Ädellövskog på våtmark',
  127: 'Triviallövskog med ädellövinslag på våtmark',
  128: 'Temporärt ej skog på våtmark',
  200: 'Öppen våtmark (underindelning saknas)',
  211: 'Buskmyr',
  212: 'Ristuvemyr',
  213: 'Fastmattemyr, mager',
  214: 'Fastmattemyr, frodig',
  215: 'Sumpkärr',
  216: 'Mjukmattemyr',
  217: 'Lösbottenmyr',
  218: 'Övrig öppen myr',
  221: 'Trädbevuxen våtmark, risbevuxen',
  222: 'Risdominerad våtmark',
  223: 'Gräsdominerad våtmark, mager',
  224: 'Gräsdominerad våtmark, frodvuxen',
  225: 'Gräsdominerad våtmark, högvuxen',
  226: 'Mossdominerad våtmark',
  227: 'Våtmark utan växttäcke',
  228: 'Övrig öppen våtmark',
  230: 'Låg fjällskog på övrig våtmark',
  411: 'Öppen mark utan vegetation (ej glaciär)',
  412: 'Glaciär',
  413: 'Varaktigt snöfält',
  4211: 'Torr buskdominerad mark',
  4212: 'Frisk buskdominerad mark',
  4213: 'Frisk-fuktig buskdominerad mark',
  4221: 'Torr risdominerad mark',
  4222: 'Frisk risdominerad mark',
  4223: 'Frisk-fuktig risdominerad mark',
  4231: 'Torr gräsdominerad mark',
  4232: 'Frisk gräsdominerad mark',
  4233: 'Frisk-fuktig gräsdominerad mark',
};

export type NmdMbKategori =
  | 'skog'
  | 'jordbruksmark'
  | 'vatmark'
  | 'vatten'
  | 'exploaterad'
  | 'fjall'
  | 'oppen_mark'
  | 'okand';

export function getNmdMbKategori(code: number): NmdMbKategori {
  if (code >= 111 && code <= 128) return 'skog';
  if (code === 23 || code === 43) return 'fjall';
  if (code === 3) return 'jordbruksmark';
  if ((code >= 200 && code <= 230) || (code >= 211 && code <= 228)) return 'vatmark';
  if (code === 61 || code === 62) return 'vatten';
  if (code >= 51 && code <= 54) return 'exploaterad';
  if (code >= 411 && code <= 4233) return 'oppen_mark';
  return 'okand';
}
