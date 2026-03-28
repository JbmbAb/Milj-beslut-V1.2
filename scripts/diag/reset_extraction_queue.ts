import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('Resetting parsed flag for newly extracted/OCR docs...');
    
    // Find documents that have searchable text (searchText or DocumentContent)
    // but whose attachments are marked as parsed (preventing re-extraction)
    // We only want to reset if they were previously parsed while empty.
    
    const result = await prisma.$executeRawUnsafe(`
      UPDATE attachments 
      SET parsed = false 
      WHERE parsed = true 
      AND document_id IN (
        SELECT id FROM "DocumentRecord" 
        WHERE status IN ('TEXT_EXTRACTED', 'EMBEDDED')
      )
      AND (extracted_text IS NULL OR extracted_text = '' OR extracted_text LIKE '%PDF utan extraherbar text%');
    `);
    
    console.log(`Reset ${result} attachments for re-extraction.`);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
