import fs from 'node:fs';

const lines = fs.readFileSync('types.ts', 'utf8').split(/\r?\n/);
const chunks = {
  'src/types/core.ts': [0, 61],
  'src/types/transport.ts': [61, 200],
  'src/types/shared.ts': [200, 264],
  'src/types/project.ts': [264, 480],
  'src/types/search.ts': [480, 570],
  'src/types/app.ts': [570, 750],
  'src/types/admin.ts': [750, 1412],
  'src/types/sewage.ts': [1412, lines.length],
};

fs.mkdirSync('src/types', { recursive: true });
for (const [file, [start, end]] of Object.entries(chunks)) {
  fs.writeFileSync(file, `${lines.slice(start, end).join('\n')}\n`);
}

const indexLines = Object.keys(chunks).map((file) => {
  const mod = file.replace('src/types/', '').replace('.ts', '');
  return `export * from './${mod}.ts';`;
});
fs.writeFileSync('src/types/index.ts', `${indexLines.join('\n')}\n`);

fs.writeFileSync(
  'types.ts',
  "/** @deprecated Import from './src/types' — shim for backward compatibility. */\nexport * from './src/types/index.ts';\n",
);

console.log('split-types-domains: ok');
