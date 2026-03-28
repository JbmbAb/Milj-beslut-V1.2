import fs from 'fs';

const data = JSON.parse(fs.readFileSync('coverage_report.json', 'utf8'));
const total = data.total || (data.coverage && data.coverage.total) || data;

console.log('--- COVERAGE SUMMARY ---');
console.log('Branches:', total.branches ? total.branches.pct : 'N/A', '%');
console.log('Statements:', total.statements ? total.statements.pct : 'N/A', '%');
console.log('Functions:', total.functions ? total.functions.pct : 'N/A', '%');
console.log('Lines:', total.lines ? total.lines.pct : 'N/A', '%');
