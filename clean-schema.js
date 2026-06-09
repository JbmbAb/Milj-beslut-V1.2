const fs = require('fs');
const path = 'prisma/schema.prisma';
let content = fs.readFileSync(path, 'utf8');

// Match any model that has an @@schema that is NOT "public"
// It looks for "model Name {" and everything up to the next "}" 
// but only if it contains @@schema("env"), @@schema("core"), @@schema("topo10"), @@schema("tiger"), @@schema("topology")
content = content.replace(/model\s+\w+\s+\{[\s\S]*?@@schema\("(env|core|topo10|tiger|topology)"\)[\s\S]*?\}/g, '');

// Also remove the spatial_migrations model completely to avoid TTY prompt
content = content.replace(/model\s+spatial_migrations\s+\{[\s\S]*?\}/g, '');

fs.writeFileSync(path, content, 'utf8');
console.log('Schema cleaned!');
