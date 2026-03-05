param(
  [switch]$Full
)

$ErrorActionPreference = 'Stop'

Write-Host '== Miljobeslut.se 2.0 QA Runner =='

npm run typecheck
npm run lint
npm run format:check
npm run test:unit
npm run test:integration

if ($Full) {
  npm run build
  npm run test:e2e
}

Write-Host 'QA runner completed successfully.'
