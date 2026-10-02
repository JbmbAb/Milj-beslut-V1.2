# ProtectedRelationGate.ps1 -- U30F F1 (PRES-05): the PowerShell binding of the protected relation gate.
#
# Dot-source it, then call Assert-UngovernedWriteAllowed before every destructive statement:
#   . (Join-Path $PSScriptRoot '..\lib\ProtectedRelationGate.ps1')
#   Assert-UngovernedWriteAllowed -Caller 'scripts/x.ps1' -Operation 'DROP' -Relation 'env.sgu_well'
#
# The definition is the file the TypeScript gate reads
# (packages/spatial-provider-postgis/src/protected-relations.v1.json); the classification is a port of
# ProtectedRelations.ts, held to it by tests/unit/protectedRelationGateInventory.test.ts. A protected or
# unresolvable relation throws; a missing or malformed definition throws (fail-closed). No override,
# no switch, no environment variable. Dot-sourcing defines functions only; nothing touches a database.

$script:ProtectedRelationsFile = Join-Path $PSScriptRoot '..\..\packages\spatial-provider-postgis\src\protected-relations.v1.json'

function Get-ProtectedRelationDefinition {
    $doc = Get-Content -LiteralPath $script:ProtectedRelationsFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($doc.contract -ne 'mimer-protected-relations-v1') { throw 'PROTECTED_RELATIONS_DEFINITION_INVALID: contract' }
    $schemas = @($doc.retained_staging_schemas)
    if ($schemas.Count -eq 0 -or ($schemas | Where-Object { $_ -cnotmatch '^[a-z_][a-z0-9_]*$' })) { throw 'PROTECTED_RELATIONS_DEFINITION_INVALID: retained_staging_schemas' }
    $entries = @()
    foreach ($r in @($doc.relations)) {
        $parts = "$($r.relation)".Split('.')
        if ($parts.Count -ne 2 -or $parts[0] -cnotmatch '^[a-z_][a-z0-9_]*$' -or $parts[1] -cnotmatch '^[a-z_][a-z0-9_]*$' -or @('LU_LIVE_LAYER', 'LU_DERIVED') -cnotcontains $r.class) {
            throw "PROTECTED_RELATIONS_DEFINITION_INVALID: $($r.relation)"
        }
        $entries += [pscustomobject]@{ Relation = $r.relation; Schema = $parts[0]; Table = $parts[1]; Class = $r.class }
    }
    if ($entries.Count -eq 0) { throw 'PROTECTED_RELATIONS_DEFINITION_INVALID: relations' }
    return [pscustomobject]@{ RetainedStagingSchemas = $schemas; Relations = $entries }
}

function ConvertTo-ProtectedRelationName([string]$Raw) {
    $text = ($Raw.Trim() -replace '(?i)^ONLY\s+', '') -replace '\s*\*$', ''
    $parts = @()
    $pos = 0
    $re = [regex]'\G\s*(?:"((?:[^"]|"")+)"|([A-Za-z_][A-Za-z0-9_$]*))\s*'
    while ($true) {
        $m = $re.Match($text, $pos)
        if (-not $m.Success) { return $null }
        if ($m.Groups[1].Success) { $parts += $m.Groups[1].Value.Replace('""', '"') } else { $parts += $m.Groups[2].Value.ToLowerInvariant() }
        $pos = $m.Index + $m.Length
        if ($pos -eq $text.Length) { break }
        if ($text[$pos] -ne '.') { return $null }
        $pos += 1
    }
    if ($parts.Count -eq 1) { return [pscustomobject]@{ Schema = $null; Table = $parts[0] } }
    if ($parts.Count -eq 2 -or $parts.Count -eq 3) { return [pscustomobject]@{ Schema = $parts[$parts.Count - 2]; Table = $parts[$parts.Count - 1] } }
    return $null
}

function Get-ProtectedRelationClassification([string]$Relation) {
    $d = Get-ProtectedRelationDefinition
    $name = ConvertTo-ProtectedRelationName $Relation
    if ($null -eq $name) { return [pscustomobject]@{ kind = 'UNRESOLVABLE'; relation = $Relation.Trim(); class = $null } }
    $display = if ($null -eq $name.Schema) { $name.Table } else { "$($name.Schema).$($name.Table)" }
    $suffixOf = { param($entry, $table) if ($table.StartsWith("$($entry.Table)_", [StringComparison]::Ordinal)) { $table.Substring($entry.Table.Length + 1) } else { $null } }
    if ($null -ne $name.Schema) {
        if ($d.RetainedStagingSchemas -ccontains $name.Schema) { return [pscustomobject]@{ kind = 'PROTECTED'; relation = $display; class = 'RETAINED_STAGING' } }
        foreach ($e in $d.Relations) {
            if ($e.Schema -cne $name.Schema) { continue }
            $suffix = & $suffixOf $e $name.Table
            if ($e.Table -ceq $name.Table -or ($null -ne $suffix -and $suffix -cmatch '^(g\d+|default)$')) {
                return [pscustomobject]@{ kind = 'PROTECTED'; relation = $display; class = $e.Class }
            }
        }
        return [pscustomobject]@{ kind = 'UNPROTECTED'; relation = $display; class = $null }
    }
    foreach ($e in $d.Relations) {
        $suffix = & $suffixOf $e $name.Table
        if ($e.Table -ceq $name.Table -or ($null -ne $suffix -and $suffix -cmatch '^(g\d+|default)$')) {
            return [pscustomobject]@{ kind = 'PROTECTED'; relation = $display; class = $e.Class }
        }
        if ($null -ne $suffix -and $suffix -cmatch '^[0-9a-f]{8}$') {
            return [pscustomobject]@{ kind = 'PROTECTED'; relation = $display; class = 'RETAINED_STAGING' }
        }
    }
    return [pscustomobject]@{ kind = 'UNPROTECTED'; relation = $display; class = $null }
}

function Get-ProtectedSchemaClassification([string]$Schema) {
    $d = Get-ProtectedRelationDefinition
    $name = ConvertTo-ProtectedRelationName $Schema
    if ($null -eq $name -or $null -ne $name.Schema) { return [pscustomobject]@{ kind = 'UNRESOLVABLE'; relation = $Schema; class = $null } }
    if ($d.RetainedStagingSchemas -ccontains $name.Table) { return [pscustomobject]@{ kind = 'PROTECTED'; relation = "$($name.Table).*"; class = 'RETAINED_STAGING' } }
    $held = $d.Relations | Where-Object { $_.Schema -ceq $name.Table } | Select-Object -First 1
    if ($held) { return [pscustomobject]@{ kind = 'PROTECTED'; relation = "$($name.Table).*"; class = $held.Class } }
    return [pscustomobject]@{ kind = 'UNPROTECTED'; relation = "$($name.Table).*"; class = $null }
}

function Assert-UngovernedWriteAllowed {
    param(
        [Parameter(Mandatory = $true)][string]$Caller,
        [Parameter(Mandatory = $true)][string]$Operation,
        [Parameter(Mandatory = $true)][string]$Relation
    )
    try {
        $c = if ($Operation -eq 'DROP_SCHEMA') { Get-ProtectedSchemaClassification $Relation } else { Get-ProtectedRelationClassification $Relation }
    } catch {
        throw "REJECT_DESTRUCTIVE_WRITE_TARGET_UNRESOLVABLE: $Caller may not $Operation ${Relation}: the protected relation definition could not be read: $($_.Exception.Message)"
    }
    if ($c.kind -eq 'UNPROTECTED') { return }
    if ($c.kind -eq 'UNRESOLVABLE') {
        throw "REJECT_DESTRUCTIVE_WRITE_TARGET_UNRESOLVABLE: $Caller may not $Operation ${Relation}: not a relation name"
    }
    throw "REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION: $Caller may not $Operation $($c.relation): $($c.class); only the governed import path may change it. There is no override."
}
