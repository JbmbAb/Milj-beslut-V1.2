param(
  [Parameter(Mandatory = $true)]
  [string]$DatabaseUrl,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedDatabaseName,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedHeadSha,

  [string]$OutputRoot = (Join-Path $env:TEMP 'mimer-public-prisma-baseline-recon')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Require-Command {
  param([Parameter(Mandatory = $true)][string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

function Invoke-NativeText {
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  $output = & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command failed with exit code $LASTEXITCODE"
  }
  return ($output -join [Environment]::NewLine)
}

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Content
  )

  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

Require-Command -Name 'git'
Require-Command -Name 'psql'
Require-Command -Name 'pg_dump'

$repoRoot = (Invoke-NativeText -Command 'git' -Arguments @('rev-parse', '--show-toplevel')).Trim()
$headSha = (Invoke-NativeText -Command 'git' -Arguments @('-C', $repoRoot, 'rev-parse', 'HEAD')).Trim()

if ($headSha -ne $ExpectedHeadSha) {
  throw "HEAD mismatch. Expected $ExpectedHeadSha but found $headSha"
}

$gitStatus = Invoke-NativeText -Command 'git' -Arguments @(
  '-C',
  $repoRoot,
  'status',
  '--porcelain=v1',
  '--untracked-files=all'
)

if (-not [string]::IsNullOrWhiteSpace($gitStatus)) {
  throw 'Working tree is not clean. Run this capture from a clean checkout/worktree.'
}

$branch = (Invoke-NativeText -Command 'git' -Arguments @(
  '-C',
  $repoRoot,
  'branch',
  '--show-current'
)).Trim()

$catalogSqlPath = Join-Path $repoRoot 'scripts\db\public-prisma-baseline-catalog.sql'
$schemaPrismaPath = Join-Path $repoRoot 'prisma\schema.prisma'
$migrationsRoot = Join-Path $repoRoot 'prisma\migrations'

foreach ($requiredPath in @($catalogSqlPath, $schemaPrismaPath, $migrationsRoot)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "Required repository path is missing: $requiredPath"
  }
}

$previousPgOptions = $env:PGOPTIONS
$env:PGOPTIONS = '-c default_transaction_read_only=on'

try {
  $actualDatabaseName = (
    Invoke-NativeText -Command 'psql' -Arguments @(
      "--dbname=$DatabaseUrl",
      '-X',
      '-qAt',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      'SELECT current_database();'
    )
  ).Trim()

  if ($actualDatabaseName -ne $ExpectedDatabaseName) {
    throw "Database target mismatch. Expected '$ExpectedDatabaseName' but connected to '$actualDatabaseName'."
  }

  $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
  $captureDir = Join-Path $OutputRoot "public-prisma-baseline-$timestamp-$($headSha.Substring(0, 12))"

  if (Test-Path -LiteralPath $captureDir) {
    throw "Capture directory already exists: $captureDir"
  }

  New-Item -ItemType Directory -Path $captureDir -Force:$false | Out-Null

  $catalogPath = Join-Path $captureDir 'public-catalog.json'
  $dumpPath = Join-Path $captureDir 'public-schema.sql'
  $ledgerPath = Join-Path $captureDir 'prisma-migrations-ledger.json'
  $schemaCopyPath = Join-Path $captureDir 'schema.prisma'
  $migrationManifestPath = Join-Path $captureDir 'migration-files.json'
  $metadataPath = Join-Path $captureDir 'capture-metadata.json'
  $gitStatusPath = Join-Path $captureDir 'git-status.txt'
  $checksumsPath = Join-Path $captureDir 'checksums.sha256'

  $catalogJson = Invoke-NativeText -Command 'psql' -Arguments @(
    "--dbname=$DatabaseUrl",
    '-X',
    '-qAt',
    '-v',
    'ON_ERROR_STOP=1',
    '-f',
    $catalogSqlPath
  )
  Write-Utf8NoBom -Path $catalogPath -Content $catalogJson

  $ledgerExists = (
    Invoke-NativeText -Command 'psql' -Arguments @(
      "--dbname=$DatabaseUrl",
      '-X',
      '-qAt',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      "SELECT to_regclass('public._prisma_migrations') IS NOT NULL;"
    )
  ).Trim()

  if ($ledgerExists -eq 't') {
    $ledgerSql = @'
SELECT jsonb_pretty(
  jsonb_build_object(
    'present', true,
    'rows', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'checksum', checksum,
          'migration_name', migration_name,
          'started_at', started_at,
          'finished_at', finished_at,
          'rolled_back_at', rolled_back_at,
          'applied_steps_count', applied_steps_count
        )
        ORDER BY started_at, migration_name
      ),
      '[]'::jsonb
    )
  )
)
FROM "_prisma_migrations";
'@
    $ledgerJson = Invoke-NativeText -Command 'psql' -Arguments @(
      "--dbname=$DatabaseUrl",
      '-X',
      '-qAt',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      $ledgerSql
    )
  } else {
    $ledgerJson = '{"present":false,"rows":[]}'
  }
  Write-Utf8NoBom -Path $ledgerPath -Content $ledgerJson

  $dumpArguments = @(
    "--dbname=$DatabaseUrl",
    '--schema-only',
    '--schema=public',
    '--no-owner',
    '--no-privileges',
    "--file=$dumpPath"
  )
  & pg_dump @dumpArguments
  if ($LASTEXITCODE -ne 0) {
    throw "pg_dump failed with exit code $LASTEXITCODE"
  }

  Copy-Item -LiteralPath $schemaPrismaPath -Destination $schemaCopyPath

  $migrationFiles = Get-ChildItem -LiteralPath $migrationsRoot -Recurse -File |
    Sort-Object FullName |
    ForEach-Object {
      $relative = [System.IO.Path]::GetRelativePath($repoRoot, $_.FullName).Replace('\', '/')
      [pscustomobject]@{
        path       = $relative
        sha256     = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        size_bytes = $_.Length
      }
    }

  $migrationManifestJson = $migrationFiles | ConvertTo-Json -Depth 4
  Write-Utf8NoBom -Path $migrationManifestPath -Content $migrationManifestJson
  Write-Utf8NoBom -Path $gitStatusPath -Content ''

  $metadata = [ordered]@{
    capture_schema         = 'public-prisma-baseline-capture-v1'
    captured_at_utc        = [DateTime]::UtcNow.ToString('o')
    database_name          = $actualDatabaseName
    git_head_sha           = $headSha
    git_branch             = $branch
    git_worktree_clean     = $true
    psql_version           = (Invoke-NativeText -Command 'psql' -Arguments @('--version')).Trim()
    pg_dump_version        = (Invoke-NativeText -Command 'pg_dump' -Arguments @('--version')).Trim()
    git_version            = (Invoke-NativeText -Command 'git' -Arguments @('--version')).Trim()
    database_url_persisted = $false
  }

  Write-Utf8NoBom -Path $metadataPath -Content ($metadata | ConvertTo-Json -Depth 4)

  $hashTargets = Get-ChildItem -LiteralPath $captureDir -File |
    Where-Object { $_.Name -ne 'checksums.sha256' } |
    Sort-Object Name

  $checksumLines = foreach ($file in $hashTargets) {
    $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $($file.Name)"
  }
  Write-Utf8NoBom -Path $checksumsPath -Content ($checksumLines -join [Environment]::NewLine)

  Write-Host 'PUBLIC-PRISMA baseline capture complete.'
  Write-Host "Database: $actualDatabaseName"
  Write-Host "HEAD:     $headSha"
  Write-Host "Output:   $captureDir"
} finally {
  $env:PGOPTIONS = $previousPgOptions
}
