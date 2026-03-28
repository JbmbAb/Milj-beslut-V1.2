import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// A small sample of common mappings based on the analysis
const MAPPING: Record<string, string> = {
  'hassleholm': 'Hässleholm',
  'soderkoping': 'Söderköping',
  'falkenberg': 'Falkenberg',
  'enkoping': 'Enköping',
  'karlstad': 'Karlstad',
  'lillaedet': 'Lilla Edet',
  'tranas': 'Tranås',
  'varberg': 'Varberg',
  'hedemora': 'Hedemora',
  'malmo': 'Malmö',
  'ostragoinge': 'Östra Göinge',
  'sundbyberg': 'Sundbyberg',
  'landskrona': 'Landskrona',
  'timra': 'Timrå',
  'sater': 'Säter',
  'lessebo': 'Lessebo',
  'staffanstorp': 'Staffanstorp',
  'boras': 'Borås',
  'karlskrona': 'Karlskrona',
  'vara': 'Vara',
  'linkoping': 'Linköping',
  'huddinge': 'Huddinge',
  'saffle': 'Säffle',
  'krokom': 'Krokom',
  'amal': 'Åmål',
  'almhult': 'Älmhult',
  'ale': 'Ale',
  'osby': 'Osby',
  'vastervik': 'Västervik',
  'skara': 'Skara',
  'vaxjo': 'Växjö',
  'umea': 'Umeå',
  'lulea': 'Luleå',
  'skelleftea': 'Skellefteå',
  'taby': 'Täby',
  'solna': 'Solna',
  'nacka': 'Nacka',
  'botkyrka': 'Botkyrka',
  'haninge': 'Haninge',
  'tyreso': 'Tyresö',
  'uppsala': 'Uppsala',
  'vasteras': 'Västerås',
  'orebro': 'Örebro',
  'jonkoping': 'Jönköping',
  'norrkoping': 'Norrköping',
  'sodertalje': 'Södertälje',
  'eskilstuna': 'Eskilstuna',
  'halmstad': 'Halmstad',
  'gavle': 'Gävle'
};

function normalizeName(name: string): string {
  const lower = name.toLowerCase().trim();
  if (MAPPING[lower]) return MAPPING[lower];
  
  // Basic capitalization for unknowns
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

async function main() {
  console.log('--- NORMALIZING MUNICIPALITIES ---');
  
  const docs = await prisma.documentRecord.findMany({
    where: { NOT: { municipality: null } },
    select: { id: true, municipality: true }
  });

  console.log(`Processing ${docs.length} documents...`);
  let docUpdates = 0;
  for (const doc of docs) {
    const raw = doc.municipality || '';
    const clean = normalizeName(raw);
    if (raw !== clean) {
      await prisma.documentRecord.update({
        where: { id: doc.id },
        data: { municipality: clean }
      });
      docUpdates++;
    }
  }

  const cases = await prisma.requirementCase.findMany({
    where: { NOT: { municipality: null } },
    select: { id: true, municipality: true }
  });

  console.log(`Processing ${cases.length} requirement cases...`);
  let caseUpdates = 0;
  for (const c of cases) {
    const raw = c.municipality || '';
    const clean = normalizeName(raw);
    if (raw !== clean) {
      await prisma.requirementCase.update({
        where: { id: c.id },
        data: { municipality: clean }
      });
      caseUpdates++;
    }
  }

  console.log(`Updated ${docUpdates} documents and ${caseUpdates} cases.`);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
