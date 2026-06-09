const fs = require('fs');
const path = 'prisma/migrations/20260608084852_add_organisation_and_nmd/migration.sql';
let content = fs.readFileSync(path, 'utf8');

// Also strip any BOM if present
content = content.replace(/^\uFEFF/, '');

const blocks = content.split('\n\n');
const keep = [];

for (const block of blocks) {
    if (block.includes('DROP INDEX "env_')) continue;
    if (block.includes('ALTER TABLE "env"')) continue;
    if (block.includes('ALTER TABLE "env_')) continue;
    if (block.includes('DROP SEQUENCE "env_')) continue;
    if (block.includes('CREATE TABLE "env"')) continue;
    if (block.includes('CREATE TABLE "core"')) continue;
    if (block.includes('CREATE TABLE "tiger"')) continue;
    if (block.includes('CREATE TABLE "topology"')) continue;
    if (block.includes('DROP TABLE "env"')) continue;
    if (block.includes('DROP SEQUENCE "spatial_migrations')) continue;
    
    keep.push(block);
}

fs.writeFileSync(path, keep.join('\n\n'), 'utf8');
console.log('Migration cleaned!');
