# ProtectedRelationGate.ps1 -- U30F F1 / U30F2 M1-M2 (PRES-05): the PowerShell binding of the protected relation gate.
#
# Dot-source it, then go through the gate at every call that writes:
#   . (Join-Path $PSScriptRoot '..\lib\ProtectedRelationGate.ps1')
#   Invoke-DbSql (Get-GatedSql -Caller 'scripts/x.ps1' -Sql $sql)
#   & $ogr2ogr @(Assert-Ogr2ogrWriteAllowed -Caller 'scripts/x.ps1' -Arguments $ogrArgs)
#   Assert-CommandWriteAllowed -Caller 'scripts/x.ps1' -Command $commandLine
#   Assert-UngovernedWriteAllowed -Caller 'scripts/x.ps1' -Operation 'DROP' -Relation 'env.sgu_well'
#
# It reads the SAME two files the TypeScript gate reads
# (packages/spatial-provider-postgis/src/protected-relations.v1.json and
# protected-relation-classification.v1.json) and implements the same algorithm as ProtectedRelations.ts and
# ProtectedWriteClassifier.ts; tests/unit/protectedRelationGateBindings.test.ts holds it to identical verdicts
# over one corpus plus generated variations (Invoke-ProtectedWriteCorpus). A protected or unresolvable target
# throws; a missing or malformed definition throws (fail-closed). No override, no switch, no environment
# variable. Dot-sourcing defines functions only; nothing touches a database.
#
# PowerShell compares strings without case by default: every comparison here is ordinal (-ceq, -ccontains,
# [StringComparison]::Ordinal) and every regex end anchor is \z, so the verdicts equal the other bindings'.

$script:PrgSrc = Join-Path $PSScriptRoot '..\..\packages\spatial-provider-postgis\src'
$script:ProtectedRelationsFile = Join-Path $script:PrgSrc 'protected-relations.v1.json'
$script:ProtectedClassificationFile = Join-Path $script:PrgSrc 'protected-relation-classification.v1.json'
$script:PrgSpec = $null

class PrgTok {
    [string]$t
    [string]$v
    [bool]$adj
    [bool]$bad
    PrgTok([string]$t, [string]$v, [bool]$adj, [bool]$bad) { $this.t = $t; $this.v = $v; $this.adj = $adj; $this.bad = $bad }
}

class PrgName {
    # Untyped on purpose: a [string] property would turn $null (unqualified) into '' (qualified with '').
    $Schema
    [string]$Table
    PrgName([object]$schema, [string]$table) { $this.Schema = $schema; $this.Table = $table }
}

class PrgTarget {
    [string]$Op
    [string]$Scope
    [PrgName]$Name
    PrgTarget([string]$op, [string]$scope, [PrgName]$name) { $this.Op = $op; $this.Scope = $scope; $this.Name = $name }
}

class PrgAcc {
    [System.Collections.Generic.List[PrgTarget]]$Targets = [System.Collections.Generic.List[PrgTarget]]::new()
    [System.Collections.Generic.List[string[]]]$Unresolved = [System.Collections.Generic.List[string[]]]::new()
    [void] Target([string]$op, [string]$scope, [PrgName]$name) { $this.Targets.Add([PrgTarget]::new($op, $scope, $name)) }
    [void] Unres([string]$op, [string]$reason) { $this.Unresolved.Add([string[]]@($op, $reason)) }
    [void] Merge([PrgAcc]$o) { foreach ($t in $o.Targets) { $this.Targets.Add($t) }; foreach ($u in $o.Unresolved) { $this.Unresolved.Add($u) } }
}

# ---------------------------------------------------------------------------------------------------------------
# Definition and specification
# ---------------------------------------------------------------------------------------------------------------

function Get-ProtectedRelationDefinition {
    $doc = Get-Content -LiteralPath $script:ProtectedRelationsFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($doc.contract -cne 'mimer-protected-relations-v1') { throw 'PROTECTED_RELATIONS_DEFINITION_INVALID: contract' }
    $schemas = @($doc.retained_staging_schemas)
    if ($schemas.Count -eq 0 -or ($schemas | Where-Object { $_ -cnotmatch '^[a-z_][a-z0-9_]*\z' })) { throw 'PROTECTED_RELATIONS_DEFINITION_INVALID: retained_staging_schemas' }
    $entries = @()
    foreach ($r in @($doc.relations)) {
        $parts = "$($r.relation)".Split('.')
        if ($parts.Count -ne 2 -or $parts[0] -cnotmatch '^[a-z_][a-z0-9_]*\z' -or $parts[1] -cnotmatch '^[a-z_][a-z0-9_]*\z' -or @('LU_LIVE_LAYER', 'LU_DERIVED') -cnotcontains $r.class) {
            throw "PROTECTED_RELATIONS_DEFINITION_INVALID: $($r.relation)"
        }
        $entries += [pscustomobject]@{ Relation = $r.relation; Schema = $parts[0]; Table = $parts[1]; Class = $r.class }
    }
    if ($entries.Count -eq 0) { throw 'PROTECTED_RELATIONS_DEFINITION_INVALID: relations' }
    return [pscustomobject]@{ RetainedStagingSchemas = $schemas; Relations = $entries }
}

function Get-ProtectedClassificationSpec {
    if ($null -ne $script:PrgSpec) { return $script:PrgSpec }
    $doc = Get-Content -LiteralPath $script:ProtectedClassificationFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($doc.contract -cne 'mimer-protected-relation-classification-v1') { throw 'PROTECTED_RELATION_CLASSIFICATION_INVALID: contract' }
    $lengths = @([int]$doc.relation_naming.current.digest_hex_length) + @($doc.relation_naming.legacy | ForEach-Object { [int]$_.digest_hex_length })
    foreach ($n in $lengths) { if ($n -lt 8 -or $n -gt 64) { throw 'PROTECTED_RELATION_CLASSIFICATION_INVALID: relation_naming' } }
    if (@($lengths | Select-Object -Unique).Count -ne $lengths.Count) { throw 'PROTECTED_RELATION_CLASSIFICATION_INVALID: relation_naming' }
    if ([int]$doc.relation_naming.max_identifier_bytes -ne 63) { throw 'PROTECTED_RELATION_CLASSIFICATION_INVALID: max_identifier_bytes' }
    foreach ($k in @('sql', 'ogr2ogr', 'commands', 'schema_operations', 'partition_suffix_pattern')) {
        if ($null -eq $doc.$k) { throw "PROTECTED_RELATION_CLASSIFICATION_INVALID: $k" }
    }
    $tools = [System.Collections.Generic.Dictionary[string, string]]::new([StringComparer]::Ordinal)
    foreach ($p in $doc.commands.tools.PSObject.Properties) { $tools[$p.Name] = [string]$p.Value }
    $wrappers = [System.Collections.Generic.Dictionary[string, string[]]]::new([StringComparer]::Ordinal)
    foreach ($p in $doc.commands.shell_wrappers.PSObject.Properties) { $wrappers[$p.Name] = [string[]]@($p.Value) }
    $postgis = [System.Collections.Generic.Dictionary[string, string]]::new([StringComparer]::Ordinal)
    foreach ($p in $doc.sql.postgis_functions.PSObject.Properties) { $postgis[$p.Name] = [string]$p.Value }
    $modes = [System.Collections.Generic.List[string[]]]::new()
    foreach ($p in $doc.ogr2ogr.write_mode_flags.PSObject.Properties) { $modes.Add([string[]]@($p.Name, [string]$p.Value)) }
    $kinds = { param($list) $out = [System.Collections.Generic.List[string[]]]::new(); foreach ($k in @($list)) { $out.Add([string[]]@($k)) }; , $out }
    $script:PrgSpec = [pscustomobject]@{
        Open = [string]$doc.dynamic_placeholder_open
        Close = [string]$doc.dynamic_placeholder_close
        Lengths = [int[]]$lengths
        PartitionPattern = [string]$doc.partition_suffix_pattern
        AnyPrefix = [bool]$doc.unqualified_names.retained_shape_any_prefix
        SchemaOperations = [string[]]@($doc.schema_operations)
        Triggers = [string[]]@($doc.sql.trigger_words)
        MaxNesting = [int]$doc.sql.max_nesting
        Reserved = [string[]]@($doc.sql.reserved_at_name_position)
        RelationKinds = (& $kinds $doc.sql.relation_object_kinds)
        DropUnresolvableKinds = (& $kinds $doc.sql.drop_unresolvable_object_kinds)
        DropOnKinds = [string[]]@($doc.sql.drop_on_object_kinds)
        CreateModifiers = [string[]]@($doc.sql.create_modifiers)
        StatementStartAfter = [string[]]@($doc.sql.statement_start_after)
        DynamicStatementAfter = [string[]]@($doc.sql.dynamic_statement_after)
        DynamicStatementAfterExplain = [string[]]@($doc.sql.dynamic_statement_after_explain)
        TruncateNotAfter = [string[]]@($doc.sql.truncate_not_after)
        UpdateNotAfter = [string[]]@($doc.sql.update_not_after)
        ExecuteNotAfter = [string[]]@($doc.sql.execute_not_after)
        ExecuteNotBefore = [string[]]@($doc.sql.execute_not_before)
        PostgisFunctions = $postgis
        DynamicExecFunctions = [string[]]@($doc.sql.dynamic_exec_functions)
        PsqlMetaCopy = [string[]]@($doc.sql.psql_meta_copy)
        PsqlMetaUnresolvable = [string[]]@($doc.sql.psql_meta_unresolvable)
        OgrFormatFlags = [string[]]@($doc.ogr2ogr.format_flags)
        OgrDatabaseFormats = [string[]]@($doc.ogr2ogr.database_formats)
        OgrDumpFormats = [string[]]@($doc.ogr2ogr.sql_dump_formats)
        OgrLayerNameFlags = [string[]]@($doc.ogr2ogr.layer_name_flags)
        OgrLcoFlags = [string[]]@($doc.ogr2ogr.layer_creation_flags)
        OgrDooFlags = [string[]]@($doc.ogr2ogr.destination_open_flags)
        OgrSqlFlags = [string[]]@($doc.ogr2ogr.sql_flags)
        OgrModes = $modes
        OgrPrefixes = [string[]]@($doc.ogr2ogr.database_datasource_prefixes)
        OgrSchemaOptions = [string[]]@($doc.ogr2ogr.schema_options)
        OgrActiveSchemaOptions = [string[]]@($doc.ogr2ogr.active_schema_options)
        ToolSuffixes = [string[]]@($doc.commands.tool_suffixes)
        Tools = $tools
        Wrappers = $wrappers
        WrappersRestOfLine = [string[]]@($doc.commands.shell_wrappers_rest_of_line)
        PsqlCommandFlags = [string[]]@($doc.commands.psql.command_flags)
        PsqlFileFlags = [string[]]@($doc.commands.psql.file_flags)
        PsqlValueFlags = [string[]]@($doc.commands.psql.value_flags)
        OgrinfoSqlFlags = [string[]]@($doc.commands.ogrinfo.sql_flags)
        RestoreTableFlags = [string[]]@($doc.commands.pg_restore.table_flags)
        RestoreSchemaFlags = [string[]]@($doc.commands.pg_restore.schema_flags)
        RestoreListOnlyFlags = [string[]]@($doc.commands.pg_restore.list_only_flags)
        RestoreListFileFlags = [string[]]@($doc.commands.pg_restore.list_file_flags)
        ShpValueFlags = [string[]]@($doc.commands.shp2pgsql.value_flags)
        PrismaUnresolvable = (& $kinds $doc.commands.prisma.unresolvable_subcommands)
        PrismaFileExecuting = (& $kinds $doc.commands.prisma.file_executing_subcommands)
        PrismaFileFlags = [string[]]@($doc.commands.prisma.file_flags)
        PrismaStdinFlags = [string[]]@($doc.commands.prisma.stdin_flags)
    }
    return $script:PrgSpec
}

# ---------------------------------------------------------------------------------------------------------------
# Small ordinal helpers
# ---------------------------------------------------------------------------------------------------------------

function PrgAt([string]$s, [int]$i) { if ($i -ge 0 -and $i -lt $s.Length) { return [string]$s[$i] }; return '' }
function PrgLower([string]$s) {
    $sb = [System.Text.StringBuilder]::new($s.Length)
    foreach ($ch in $s.ToCharArray()) { $n = [int]$ch; if ($n -ge 65 -and $n -le 90) { [void]$sb.Append([char]($n + 32)) } else { [void]$sb.Append($ch) } }
    return $sb.ToString()
}
function PrgIsLetter([string]$c) { if ($c.Length -ne 1) { return $false }; $n = [int][char]$c; return ($n -ge 65 -and $n -le 90) -or ($n -ge 97 -and $n -le 122) }
function PrgIsDigit([string]$c) { if ($c.Length -ne 1) { return $false }; $n = [int][char]$c; return $n -ge 48 -and $n -le 57 }
function PrgIsHigh([string]$c) { return $c.Length -gt 0 -and [int][char]$c[0] -ge 0x80 }
function PrgStartsAt([string]$s, [int]$i, [string]$x) {
    if ($i -lt 0 -or $i + $x.Length -gt $s.Length) { return $false }
    return [string]::CompareOrdinal($s, $i, $x, 0, $x.Length) -eq 0
}
function PrgIndexOf([string]$s, [string]$x, [int]$from) { if ($from -gt $s.Length) { return -1 }; return $s.IndexOf($x, $from, [StringComparison]::Ordinal) }
function PrgSlice([string]$s, [int]$a, [int]$b) { if ($a -lt 0) { $a = 0 }; if ($b -gt $s.Length) { $b = $s.Length }; if ($b -le $a) { return '' }; return $s.Substring($a, $b - $a) }
function PrgDyn([string]$hint) {
    $spec = Get-ProtectedClassificationSpec
    $clean = [regex]::Replace("$hint", '[^A-Za-z0-9_.-]', '')
    if ($clean.Length -gt 0) { return "$($spec.Open):$clean$($spec.Close)" }
    return "$($spec.Open)$($spec.Close)"
}
function PrgContainsDynamic([string]$text) { return (PrgIndexOf $text (Get-ProtectedClassificationSpec).Open 0) -ge 0 }
function PrgDynamicHint([string]$text) {
    $spec = Get-ProtectedClassificationSpec
    $t = $text.Trim()
    if (-not $t.StartsWith($spec.Open, [StringComparison]::Ordinal) -or -not $t.EndsWith($spec.Close, [StringComparison]::Ordinal)) { return $null }
    if ($t.Length -lt $spec.Open.Length + $spec.Close.Length) { return $null }
    $inner = $t.Substring($spec.Open.Length, $t.Length - $spec.Open.Length - $spec.Close.Length)
    if ((PrgIndexOf $inner $spec.Open 0) -ge 0) { return $null }
    if ($inner.StartsWith(':', [StringComparison]::Ordinal)) { return $inner.Substring(1) }
    return ''
}

# ---------------------------------------------------------------------------------------------------------------
# Names and classification (ProtectedRelations.ts)
# ---------------------------------------------------------------------------------------------------------------

function ConvertTo-ProtectedRelationName([string]$Raw) {
    $text = ([regex]::Replace($Raw.Trim(), '^(?i:ONLY)\s+', '')) -creplace '\s*\*\z', ''
    $parts = [System.Collections.Generic.List[string]]::new()
    $pos = 0
    $re = [regex]'\G\s*(?:"((?:[^"]|"")+)"|([A-Za-z_][A-Za-z0-9_$]*))\s*'
    while ($true) {
        $m = $re.Match($text, $pos)
        if (-not $m.Success) { return $null }
        if ($m.Groups[1].Success) { $parts.Add($m.Groups[1].Value.Replace('""', '"')) } else { $parts.Add((PrgLower $m.Groups[2].Value)) }
        $pos = $m.Index + $m.Length
        if ($pos -eq $text.Length) { break }
        if ([string]$text[$pos] -cne '.') { return $null }
        $pos += 1
    }
    if ($parts.Count -eq 1) { return [PrgName]::new($null, $parts[0]) }
    if ($parts.Count -eq 2 -or $parts.Count -eq 3) { return [PrgName]::new($parts[$parts.Count - 2], $parts[$parts.Count - 1]) }
    return $null
}

function PrgFormatName([PrgName]$n) { if ($null -eq $n.Schema) { return $n.Table }; return "$($n.Schema).$($n.Table)" }
function PrgCanonicalPart([string]$p) { if ($p -cmatch '^[a-z_][a-z0-9_$]*\z') { return $p }; return '"' + $p.Replace('"', '""') + '"' }
function PrgCanonicalText([PrgName]$n) { if ($null -eq $n.Schema) { return (PrgCanonicalPart $n.Table) }; return "$(PrgCanonicalPart $n.Schema).$(PrgCanonicalPart $n.Table)" }
function PrgIsRetainedSuffix([string]$suffix) { return ($suffix -cmatch '^[0-9a-f]+\z') -and ((Get-ProtectedClassificationSpec).Lengths -contains $suffix.Length) }
function PrgHasRetainedShape([string]$table) {
    $m = [regex]::Match($table, '^([a-z_][a-z0-9_]*)_([0-9a-f]+)\z')
    return $m.Success -and (PrgIsRetainedSuffix $m.Groups[2].Value)
}
function PrgSuffixOf($entry, [string]$table) {
    if ($table.StartsWith("$($entry.Table)_", [StringComparison]::Ordinal)) { return $table.Substring($entry.Table.Length + 1) }
    return $null
}
function PrgIsPartitionSuffix([string]$suffix) {
    if ($null -eq $suffix -or $suffix.Contains("`n")) { return $false }
    return [regex]::IsMatch($suffix, (Get-ProtectedClassificationSpec).PartitionPattern)
}

function Get-ProtectedRelationClassification($Relation, $Definition) {
    $d = if ($Definition) { $Definition } else { Get-ProtectedRelationDefinition }
    $spec = Get-ProtectedClassificationSpec
    $name = if ($Relation -is [PrgName]) { $Relation } else { ConvertTo-ProtectedRelationName "$Relation" }
    if ($null -eq $name) { return [pscustomobject]@{ kind = 'UNRESOLVABLE'; relation = "$Relation".Trim(); class = $null } }
    $display = PrgFormatName $name
    if ($null -ne $name.Schema) {
        if ($d.RetainedStagingSchemas -ccontains $name.Schema) { return [pscustomobject]@{ kind = 'PROTECTED'; relation = $display; class = 'RETAINED_STAGING' } }
        foreach ($e in $d.Relations) {
            if ($e.Schema -cne $name.Schema) { continue }
            if ($e.Table -ceq $name.Table -or (PrgIsPartitionSuffix (PrgSuffixOf $e $name.Table))) {
                return [pscustomobject]@{ kind = 'PROTECTED'; relation = $display; class = $e.Class }
            }
        }
        return [pscustomobject]@{ kind = 'UNPROTECTED'; relation = $display; class = $null }
    }
    foreach ($e in $d.Relations) {
        $suffix = PrgSuffixOf $e $name.Table
        if ($e.Table -ceq $name.Table -or (PrgIsPartitionSuffix $suffix)) {
            return [pscustomobject]@{ kind = 'PROTECTED'; relation = $display; class = $e.Class }
        }
        if ($null -ne $suffix -and (PrgIsRetainedSuffix $suffix)) {
            return [pscustomobject]@{ kind = 'PROTECTED'; relation = $display; class = 'RETAINED_STAGING' }
        }
    }
    if ($spec.AnyPrefix -and (PrgHasRetainedShape $name.Table)) {
        return [pscustomobject]@{ kind = 'PROTECTED'; relation = $display; class = 'RETAINED_STAGING' }
    }
    return [pscustomobject]@{ kind = 'UNPROTECTED'; relation = $display; class = $null }
}

function Get-ProtectedSchemaClassification([string]$Schema, $Definition) {
    $d = if ($Definition) { $Definition } else { Get-ProtectedRelationDefinition }
    $name = ConvertTo-ProtectedRelationName $Schema
    if ($null -eq $name -or $null -ne $name.Schema) { return [pscustomobject]@{ kind = 'UNRESOLVABLE'; relation = $Schema; class = $null } }
    if ($d.RetainedStagingSchemas -ccontains $name.Table) { return [pscustomobject]@{ kind = 'PROTECTED'; relation = "$($name.Table).*"; class = 'RETAINED_STAGING' } }
    $held = $d.Relations | Where-Object { $_.Schema -ceq $name.Table } | Select-Object -First 1
    if ($held) { return [pscustomobject]@{ kind = 'PROTECTED'; relation = "$($name.Table).*"; class = $held.Class } }
    return [pscustomobject]@{ kind = 'UNPROTECTED'; relation = "$($name.Table).*"; class = $null }
}

function Test-ProtectedSchemaOperation([string]$Operation) { return (Get-ProtectedClassificationSpec).SchemaOperations -ccontains $Operation }

# ---------------------------------------------------------------------------------------------------------------
# SQL tokenizer (ProtectedWriteClassifier.ts tokenizeSql)
# ---------------------------------------------------------------------------------------------------------------

function PrgReadQuoted([string]$s, [int]$i, [string]$quote, [bool]$backslash) {
    $j = $i + 1
    $sb = [System.Text.StringBuilder]::new()
    while ($j -lt $s.Length) {
        $c = [string]$s[$j]
        if ($backslash -and $c -ceq '\') {
            if ($j + 1 -ge $s.Length) { return $null }
            [void]$sb.Append($s[$j + 1]); $j += 2; continue
        }
        if ($c -ceq $quote) {
            if ((PrgAt $s ($j + 1)) -ceq $quote) { [void]$sb.Append($quote); $j += 2; continue }
            return , @($sb.ToString(), ($j + 1))
        }
        [void]$sb.Append($c); $j += 1
    }
    return $null
}

function PrgIsHex([string]$s) { return $s.Length -gt 0 -and ($s -cmatch '^[0-9A-Fa-f]+\z') }

function PrgDecodeUnicode([string]$v) {
    $sb = [System.Text.StringBuilder]::new()
    $j = 0
    while ($j -lt $v.Length) {
        $c = [string]$v[$j]
        if ($c -cne '\') { [void]$sb.Append($c); $j += 1; continue }
        if ((PrgAt $v ($j + 1)) -ceq '\') { [void]$sb.Append('\'); $j += 2; continue }
        $six = PrgSlice $v ($j + 2) ($j + 8)
        if ((PrgAt $v ($j + 1)) -ceq '+' -and $six.Length -eq 6 -and (PrgIsHex $six)) {
            $cp = [Convert]::ToInt32($six, 16)
            if ($cp -gt 0x10FFFF -or ($cp -ge 0xD800 -and $cp -le 0xDFFF)) { return $null }
            [void]$sb.Append([char]::ConvertFromUtf32($cp)); $j += 8; continue
        }
        $four = PrgSlice $v ($j + 1) ($j + 5)
        if ($four.Length -eq 4 -and (PrgIsHex $four)) {
            $cp = [Convert]::ToInt32($four, 16)
            if ($cp -ge 0xD800 -and $cp -le 0xDFFF) { return $null }
            [void]$sb.Append([char]::ConvertFromUtf32($cp)); $j += 5; continue
        }
        return $null
    }
    return $sb.ToString()
}

function PrgFollowedByUescape([string]$s, [int]$i) {
    $j = $i
    while ($j -lt $s.Length -and ' ', "`t", "`n", "`r", "`f", "`v" -ccontains [string]$s[$j]) { $j += 1 }
    $nx = PrgAt $s ($j + 7)
    return ((PrgLower (PrgSlice $s $j ($j + 7))) -ceq 'uescape') -and -not ((PrgIsLetter $nx) -or (PrgIsDigit $nx) -or $nx -ceq '_')
}

function PrgTokenizeSql([string]$s) {
    $spec = Get-ProtectedClassificationSpec
    $o = $spec.Open; $cl = $spec.Close
    $toks = [System.Collections.Generic.List[PrgTok]]::new()
    $st = @{ last = -1; copyLine = $false }
    $ws = ' ', "`t", "`n", "`r", "`f", "`v"
    $push = { param($t, $v, $start, $end, $bad) $toks.Add([PrgTok]::new($t, $v, ($start -eq $st.last), [bool]$bad)); $st.last = $end }
    $identStart = { param($k) $ch = PrgAt $s $k; ((PrgIsLetter $ch) -or $ch -ceq '_' -or (PrgIsHigh $ch)) -and -not (PrgStartsAt $s $k $o) -and -not (PrgStartsAt $s $k $cl) }
    $identChar = { param($k) $ch = PrgAt $s $k; ((PrgIsLetter $ch) -or (PrgIsDigit $ch) -or $ch -ceq '_' -or $ch -ceq '$' -or (PrgIsHigh $ch)) -and -not (PrgStartsAt $s $k $o) -and -not (PrgStartsAt $s $k $cl) }
    $i = 0
    $n = $s.Length
    while ($i -lt $n) {
        $c = [string]$s[$i]
        if ($ws -ccontains $c) {
            if ($c -ceq "`n" -and $st.copyLine) { & $push 'SEMI' ';' $i ($i + 1) $false; $st.copyLine = $false }
            $i += 1; continue
        }
        if (PrgStartsAt $s $i $o) {
            $end = PrgIndexOf $s $cl ($i + $o.Length)
            if ($end -lt 0) { return , @($toks, 'unterminated dynamic placeholder') }
            $inner = PrgSlice $s ($i + $o.Length) $end
            $hint = if ($inner.StartsWith(':', [StringComparison]::Ordinal)) { $inner.Substring(1) } else { '' }
            & $push 'DYN' $hint $i ($end + $cl.Length) $false
            $i = $end + $cl.Length; continue
        }
        $c1 = PrgAt $s ($i + 1)
        if ($c -ceq '-' -and $c1 -ceq '-') { $nl = PrgIndexOf $s "`n" $i; $i = if ($nl -lt 0) { $n } else { $nl }; continue }
        if ($c -ceq '/' -and $c1 -ceq '*') {
            $depth = 1; $j = $i + 2
            while ($j -lt $n -and $depth -gt 0) {
                if ([string]$s[$j] -ceq '/' -and (PrgAt $s ($j + 1)) -ceq '*') { $depth += 1; $j += 2 }
                elseif ([string]$s[$j] -ceq '*' -and (PrgAt $s ($j + 1)) -ceq '/') { $depth -= 1; $j += 2 }
                else { $j += 1 }
            }
            if ($depth -gt 0) { return , @($toks, 'unterminated block comment') }
            $i = $j; continue
        }
        $c2 = PrgAt $s ($i + 2)
        if (($c -ceq 'u' -or $c -ceq 'U') -and $c1 -ceq '&' -and ($c2 -ceq "'" -or $c2 -ceq '"')) {
            $r = PrgReadQuoted $s ($i + 2) $c2 $false
            if ($null -eq $r) { if ($c2 -ceq "'") { return , @($toks, 'unterminated string') }; return , @($toks, 'unterminated quoted identifier') }
            $decoded = PrgDecodeUnicode $r[0]
            if ($c2 -ceq "'") { & $push 'STRING' $(if ($null -ne $decoded) { $decoded } else { $r[0] }) $i $r[1] $false }
            else {
                $qv = $(if ($null -ne $decoded) { $decoded } else { $r[0] })
                $bad = ($null -eq $decoded) -or (PrgFollowedByUescape $s $r[1]) -or ($r[0].Length -eq 0) -or $qv.Contains($o, [StringComparison]::Ordinal)
                & $push 'QIDENT' $(if ($null -ne $decoded) { $decoded } else { $r[0] }) $i $r[1] $bad
            }
            $i = $r[1]; continue
        }
        if (($c -ceq 'e' -or $c -ceq 'E') -and $c1 -ceq "'") {
            $r = PrgReadQuoted $s ($i + 1) "'" $true
            if ($null -eq $r) { return , @($toks, 'unterminated string') }
            & $push 'STRING' $r[0] $i $r[1] $false; $i = $r[1]; continue
        }
        if ('b', 'B', 'x', 'X', 'n', 'N' -ccontains $c -and $c1 -ceq "'") {
            $r = PrgReadQuoted $s ($i + 1) "'" $false
            if ($null -eq $r) { return , @($toks, 'unterminated string') }
            & $push 'STRING' $r[0] $i $r[1] $false; $i = $r[1]; continue
        }
        if ($c -ceq "'") {
            $r = PrgReadQuoted $s $i "'" $false
            if ($null -eq $r) { return , @($toks, 'unterminated string') }
            & $push 'STRING' $r[0] $i $r[1] $false; $i = $r[1]; continue
        }
        if ($c -ceq '"') {
            $r = PrgReadQuoted $s $i '"' $false
            if ($null -eq $r) { return , @($toks, 'unterminated quoted identifier') }
            # U30F2 H1: "${schema}" in a shell command line is a name the text does not hold
            & $push 'QIDENT' $r[0] $i $r[1] (($r[0].Length -eq 0) -or $r[0].Contains($o, [StringComparison]::Ordinal)); $i = $r[1]; continue
        }
        if ($c -ceq '$') {
            if (PrgIsDigit $c1) {
                $j = $i + 1; while ($j -lt $n -and (PrgIsDigit ([string]$s[$j]))) { $j += 1 }
                & $push 'PARAM' (PrgSlice $s $i $j) $i $j $false; $i = $j; continue
            }
            $j = $i + 1
            if (& $identStart $j) { $j += 1; while ($j -lt $n -and (& $identChar $j) -and [string]$s[$j] -cne '$') { $j += 1 } }
            if ((PrgAt $s $j) -ceq '$') {
                $tag = PrgSlice $s $i ($j + 1)
                $end = PrgIndexOf $s $tag ($j + 1)
                if ($end -lt 0) { return , @($toks, 'unterminated dollar-quoted string') }
                # `bad` on a STRING marks a dollar-quoted body (DO / function code), U30F2 H1
                & $push 'STRING' (PrgSlice $s ($j + 1) $end) $i ($end + $tag.Length) $true
                $i = $end + $tag.Length; continue
            }
            & $push 'OP' '$' $i ($i + 1) $false; $i += 1; continue
        }
        if ($c -ceq ':' -and $c1 -cne ':' -and (PrgAt $s ($i - 1)) -cne ':' -and ((& $identStart ($i + 1)) -or $c1 -ceq "'" -or $c1 -ceq '"')) {
            $j = $i + 1
            if ($c1 -ceq "'" -or $c1 -ceq '"') {
                $r = PrgReadQuoted $s $j $c1 $false
                if ($null -eq $r) { return , @($toks, 'unterminated psql variable') }
                $hint = $r[0]; $j = $r[1]
            } else {
                $start = $j; while ($j -lt $n -and (& $identChar $j)) { $j += 1 }
                $hint = PrgSlice $s $start $j
            }
            & $push 'DYN' $hint $i $j $false; $i = $j; continue
        }
        if (& $identStart $i) {
            $j = $i + 1; while ($j -lt $n -and (& $identChar $j)) { $j += 1 }
            & $push 'WORD' (PrgLower (PrgSlice $s $i $j)) $i $j $false; $i = $j; continue
        }
        if (PrgIsDigit $c) {
            $j = $i + 1
            while ($j -lt $n) {
                $cj = [string]$s[$j]
                if ((PrgIsDigit $cj) -or (PrgIsLetter $cj) -or $cj -ceq '_' -or ($cj -ceq '.' -and (PrgIsDigit (PrgAt $s ($j + 1))))) { $j += 1 } else { break }
            }
            & $push 'NUMBER' (PrgSlice $s $i $j) $i $j $false; $i = $j; continue
        }
        if ($c -ceq '\') {
            $j = $i + 1
            if ((PrgAt $s $j) -ceq '!') { $j += 1 } else { while ($j -lt $n -and (PrgIsLetter ([string]$s[$j]))) { $j += 1 } }
            $name = PrgLower (PrgSlice $s ($i + 1) $j)
            if ($name.Length -eq 0) { & $push 'OP' '\' $i ($i + 1) $false; $i += 1; continue }
            if ($spec.PsqlMetaCopy -ccontains $name) { & $push 'WORD' 'copy' $i $j $false; $st.copyLine = $true; $i = $j; continue }
            if ($spec.PsqlMetaUnresolvable -ccontains $name) { & $push 'META' $name $i $j $false }
            $nl = PrgIndexOf $s "`n" $j; $i = if ($nl -lt 0) { $n } else { $nl }; continue
        }
        if ($c -ceq ';') { & $push 'SEMI' ';' $i ($i + 1) $false }
        elseif ($c -ceq '(') { & $push 'LPAREN' '(' $i ($i + 1) $false }
        elseif ($c -ceq ')') { & $push 'RPAREN' ')' $i ($i + 1) $false }
        elseif ($c -ceq ',') { & $push 'COMMA' ',' $i ($i + 1) $false }
        elseif ($c -ceq '.') { & $push 'DOT' '.' $i ($i + 1) $false }
        elseif ($c -ceq '|' -and $c1 -ceq '|') { & $push 'OP' '||' $i ($i + 2) $false; $i += 2; continue }
        elseif ($c -ceq ':' -and $c1 -ceq ':') { & $push 'OP' '::' $i ($i + 2) $false; $i += 2; continue }
        else { & $push 'OP' $c $i ($i + 1) $false }
        $i += 1
    }
    return , @($toks, $null)
}

# ---------------------------------------------------------------------------------------------------------------
# SQL analysis (ProtectedWriteClassifier.ts SqlAnalyzer)
# ---------------------------------------------------------------------------------------------------------------

function PrgGet($toks, [int]$k) { if ($k -ge 0 -and $k -lt $toks.Count) { return $toks[$k] }; return $null }
function PrgIsT($toks, [int]$k, [string]$t) { $x = PrgGet $toks $k; return $null -ne $x -and $x.t -ceq $t }
function PrgWordAt($toks, [int]$k, [string]$v) { $x = PrgGet $toks $k; return $null -ne $x -and $x.t -ceq 'WORD' -and $x.v -ceq $v }
function PrgWordsAt($toks, [int]$k, [string[]]$seq) { for ($n = 0; $n -lt $seq.Count; $n++) { if (-not (PrgWordAt $toks ($k + $n) $seq[$n])) { return $false } }; return $true }
function PrgMatchKind($toks, [int]$k, $kinds) {
    $best = $null
    foreach ($kind in $kinds) { if ((PrgWordsAt $toks $k $kind) -and ($null -eq $best -or $kind.Count -gt $best.Count)) { $best = $kind } }
    if ($null -eq $best) { return $null }
    return , $best
}

function PrgContainsTrigger([string]$text) {
    $lower = PrgLower $text
    foreach ($w in (Get-ProtectedClassificationSpec).Triggers) {
        $from = 0
        while ($true) {
            $at = PrgIndexOf $lower $w $from
            if ($at -lt 0) { break }
            $before = if ($at -eq 0) { '' } else { [string]$lower[$at - 1] }
            $after = PrgAt $lower ($at + $w.Length)
            $bOk = ($before -ceq '') -or -not ((PrgIsLetter $before) -or (PrgIsDigit $before) -or $before -ceq '_')
            $aOk = ($after -ceq '') -or -not ((PrgIsLetter $after) -or (PrgIsDigit $after) -or $after -ceq '_')
            if ($bOk -and $aOk) { return $true }
            $from = $at + 1
        }
    }
    return $false
}

function PrgMatchParen($toks, [int]$i) {
    $depth = 0
    for ($j = $i; $j -lt $toks.Count; $j++) {
        if ($toks[$j].t -ceq 'LPAREN') { $depth += 1 }
        elseif ($toks[$j].t -ceq 'RPAREN') { $depth -= 1; if ($depth -eq 0) { return $j } }
    }
    return $toks.Count - 1
}

function PrgPieceEnd($toks, [int]$i) {
    $t = PrgGet $toks $i
    if ($null -eq $t) { return $i }
    if ($t.t -ceq 'LPAREN') { $j = (PrgMatchParen $toks $i) + 1 }
    elseif ($t.t -ceq 'WORD' -or $t.t -ceq 'QIDENT') {
        $j = $i + 1
        while ((PrgIsT $toks $j 'DOT') -and ((PrgIsT $toks ($j + 1) 'WORD') -or (PrgIsT $toks ($j + 1) 'QIDENT'))) { $j += 2 }
        if (PrgIsT $toks $j 'LPAREN') { $j = (PrgMatchParen $toks $j) + 1 }
    } else { $j = $i + 1 }
    while ((PrgIsT $toks $j 'OP') -and $toks[$j].v -ceq '::' -and (PrgIsT $toks ($j + 1) 'WORD')) { $j += 2 }
    return $j
}

function PrgEmbeddedTexts($toks, [string]$dyn) {
    $texts = [System.Collections.Generic.List[string]]::new()
    $consumed = [System.Collections.Generic.HashSet[int]]::new()
    $pieceStarts = [System.Collections.Generic.HashSet[int]]::new()
    for ($i = 0; $i -lt $toks.Count; $i++) {
        if ($pieceStarts.Contains($i)) { continue }
        $t = $toks[$i]
        if ('OP', 'SEMI', 'COMMA', 'RPAREN', 'DOT' -ccontains $t.t) { continue }
        $pieces = [System.Collections.Generic.List[int[]]]::new()
        $pieces.Add([int[]]@($i, (PrgPieceEnd $toks $i)))
        $j = $pieces[0][1]
        while ((PrgIsT $toks $j 'OP') -and $toks[$j].v -ceq '||' -and ($j + 1) -lt $toks.Count) {
            $e = PrgPieceEnd $toks ($j + 1)
            $pieces.Add([int[]]@(($j + 1), $e))
            $j = $e
        }
        $isString = { param($p) $toks[$p[0]].t -ceq 'STRING' -and ($p[1] - $p[0]) -eq 1 }
        $anyString = $false
        foreach ($p in $pieces) { if (& $isString $p) { $anyString = $true } }
        if ($pieces.Count -gt 1 -and $anyString) {
            $sb = [System.Text.StringBuilder]::new()
            foreach ($p in $pieces) { if (& $isString $p) { [void]$sb.Append($toks[$p[0]].v) } else { [void]$sb.Append($dyn) } }
            $texts.Add($sb.ToString())
            foreach ($p in $pieces) { [void]$pieceStarts.Add($p[0]); if (& $isString $p) { [void]$consumed.Add($p[0]) } }
        }
    }
    for ($k = 0; $k -lt $toks.Count; $k++) {
        $t = $toks[$k]
        if (($t.t -ceq 'STRING' -and -not $consumed.Contains($k)) -or $t.t -ceq 'QIDENT') { $texts.Add($t.v) }
    }
    $out = [System.Collections.Generic.List[string]]::new()
    foreach ($x in $texts) { if (PrgContainsTrigger $x) { $out.Add($x) } }
    # U30F2 H1: a dollar-quoted body holding a dynamic value (`DO $$BEGIN $CMD; END$$`) is code the text does not hold
    for ($k = 0; $k -lt $toks.Count; $k++) {
        $t = $toks[$k]
        if ($t.t -ceq 'STRING' -and $t.bad -and -not $consumed.Contains($k) -and -not (PrgContainsTrigger $t.v) -and (PrgContainsDynamic $t.v)) { $out.Add($t.v) }
    }
    return , $out
}

function PrgSplitStatements($toks) {
    $out = [System.Collections.Generic.List[object]]::new()
    $cur = [System.Collections.Generic.List[PrgTok]]::new()
    foreach ($t in $toks) {
        if ($t.t -ceq 'SEMI') { if ($cur.Count -gt 0) { $out.Add($cur) }; $cur = [System.Collections.Generic.List[PrgTok]]::new() }
        else { $cur.Add($t) }
    }
    if ($cur.Count -gt 0) { $out.Add($cur) }
    return , $out
}

# Returns @($name-or-null, $end)
function PrgParseNameAt($toks, [int]$j, [bool]$only = $false, [bool]$star = $false) {
    $reserved = (Get-ProtectedClassificationSpec).Reserved
    $k = $j
    if ($only -and (PrgWordAt $toks $k 'only')) { $k += 1 }
    $parts = [System.Collections.Generic.List[string]]::new()
    while ($true) {
        $t = PrgGet $toks $k
        if ($null -eq $t) { return , @($null, $k) }
        if ($t.t -ceq 'WORD' -and -not ($reserved -ccontains $t.v)) { $parts.Add($t.v) }
        elseif ($t.t -ceq 'QIDENT' -and -not $t.bad) { $parts.Add($t.v) }
        else { return , @($null, $k) }
        $k += 1
        $nx = PrgGet $toks $k
        if ($null -ne $nx -and $nx.adj -and ('WORD', 'NUMBER', 'DYN', 'PARAM', 'QIDENT', 'STRING' -ccontains $nx.t)) { return , @($null, $k) }
        if (PrgIsT $toks $k 'DOT') {
            if ($parts.Count -ge 3) { return , @($null, $k) }
            $k += 1; continue
        }
        break
    }
    if ($star -and (PrgIsT $toks $k 'OP') -and $toks[$k].v -ceq '*') { $k += 1 }
    if ($parts.Count -eq 1) { $name = [PrgName]::new($null, $parts[0]) } else { $name = [PrgName]::new($parts[$parts.Count - 2], $parts[$parts.Count - 1]) }
    return , @($name, $k)
}

function PrgPrevKey($toks, [int]$p) {
    $prev = PrgGet $toks ($p - 1)
    if ($null -eq $prev) { return $null }
    switch -CaseSensitive ($prev.t) {
        'WORD' { return $prev.v }
        'COMMA' { return ',' }
        'LPAREN' { return '(' }
        'RPAREN' { return ')' }
        'DYN' { return 'DYN' }
        default { return $prev.t }
    }
}

function PrgAtStatementStart($toks, [int]$p) {
    if ($p -eq 0) { return $true }
    $key = PrgPrevKey $toks $p
    return $null -ne $key -and ((Get-ProtectedClassificationSpec).StatementStartAfter -ccontains $key)
}

function PrgDescribeAt($toks, [int]$p) {
    $parts = @()
    for ($k = $p; $k -lt [Math]::Min($toks.Count, $p + 6); $k++) {
        $t = $toks[$k]
        $parts += $(if ($t.t -ceq 'DYN') { '<dynamic>' } elseif ($t.t -ceq 'STRING') { "'...'" } else { $t.v })
    }
    return ($parts -join ' ')
}

function PrgSplitArgs($toks) {
    $args2 = [System.Collections.Generic.List[object]]::new()
    $cur = [System.Collections.Generic.List[PrgTok]]::new()
    $depth = 0
    foreach ($t in $toks) {
        if ($t.t -ceq 'LPAREN') { $depth += 1 }
        if ($t.t -ceq 'RPAREN') { $depth -= 1 }
        if ($t.t -ceq 'COMMA' -and $depth -eq 0) { $args2.Add($cur); $cur = [System.Collections.Generic.List[PrgTok]]::new() }
        else { $cur.Add($t) }
    }
    if ($cur.Count -gt 0 -or $args2.Count -gt 0) { $args2.Add($cur) }
    return , $args2
}

function PrgSlice2($list, [int]$from, [int]$to) {
    $out = [System.Collections.Generic.List[PrgTok]]::new()
    if ($to -gt $list.Count) { $to = $list.Count }
    for ($k = [Math]::Max(0, $from); $k -lt $to; $k++) { $out.Add($list[$k]) }
    return , $out
}

function PrgFindWord($toks, [int]$from, [string]$v) {
    for ($k = $from; $k -lt $toks.Count; $k++) { if ($toks[$k].t -ceq 'WORD' -and $toks[$k].v -ceq $v) { return $k } }
    return -1
}

# Analyzer state: @{ Acc = [PrgAcc]; Path = $null | string[] | 'UNKNOWN' }
function PrgAnTarget($an, [string]$op, [PrgName]$name, [string]$scope = 'RELATION') {
    $an.Acc.Target($op, $scope, $name)
    if ($scope -ceq 'RELATION' -and $null -eq $name.Schema) {
        $path = $an.Path
        if ($path -is [string] -and $path -ceq 'UNKNOWN') { $an.Acc.Unres($op, "unqualified $($name.Table) under a search_path set from a non-constant value") }
        elseif ($null -ne $path) { foreach ($schema in $path) { $an.Acc.Target($op, $scope, [PrgName]::new($schema, $name.Table)) } }
    }
}

function PrgAnOne($an, $toks, [int]$p, [int]$j, [string]$op, [bool]$only = $false, [bool]$star = $false) {
    $r = PrgParseNameAt $toks $j $only $star
    if ($null -ne $r[0]) { PrgAnTarget $an $op $r[0] }
    elseif (PrgAtStatementStart $toks $p) { $an.Acc.Unres($op, "target is not a static relation name: $(PrgDescribeAt $toks $p)") }
    return , $r
}

function PrgAnList($an, $toks, [int]$p, [int]$j, [string]$op, [bool]$only = $false, [bool]$star = $false, [bool]$schema = $false) {
    $k = $j
    while ($true) {
        $r = PrgParseNameAt $toks $k $only $star
        if ($null -eq $r[0] -or ($schema -and $null -ne $r[0].Schema)) {
            if (PrgAtStatementStart $toks $p) { $what = if ($schema) { 'schema' } else { 'relation' }; $an.Acc.Unres($op, "target is not a static $what name: $(PrgDescribeAt $toks $p)") }
            return
        }
        if ($schema) { PrgAnTarget $an $op ([PrgName]::new($null, $r[0].Table)) 'SCHEMA' } else { PrgAnTarget $an $op $r[0] }
        $k = $r[1]
        if (-not (PrgIsT $toks $k 'COMMA')) { return }
        $k += 1
    }
}

function PrgPathValues($values) {
    if ($values.Count -eq 1 -and $values[0].t -ceq 'WORD' -and $values[0].v -ceq 'default') { return $null }
    $path = [System.Collections.Generic.List[string]]::new()
    foreach ($x in $values) {
        if ($x.t -ceq 'COMMA') { continue }
        if ($x.t -ceq 'WORD') { $path.Add($x.v) }
        elseif ($x.t -ceq 'QIDENT' -and -not $x.bad) { $path.Add($x.v) }
        elseif ($x.t -ceq 'STRING') {
            foreach ($part in $x.v.Split(',')) {
                $name = ConvertTo-ProtectedRelationName $part
                if ($part.Trim().Length -eq 0) { continue }
                if ($null -eq $name -or $null -ne $name.Schema) { return 'UNKNOWN' }
                $path.Add($name.Table)
            }
        } else { return 'UNKNOWN' }
    }
    $filtered = [string[]]@($path | Where-Object { '$user', 'pg_temp', 'pg_catalog' -cnotcontains $_ })
    return , $filtered
}

function PrgAnStatement($an, $toks) {
    $spec = Get-ProtectedClassificationSpec
    for ($p = 0; $p -lt $toks.Count; $p++) {
        $t = $toks[$p]
        if ($t.t -ceq 'META') { $an.Acc.Unres('PSQL_META', "psql \$($t.v) runs SQL the text does not contain"); continue }
        # U30F2 H1: `psql -c "$SQL"` / `BEGIN $CMD; END`: the statement's verb is not in the text
        if ($t.t -ceq 'DYN') {
            $pk = PrgPrevKey $toks $p
            $explainPrev = $null -ne $pk -and $spec.DynamicStatementAfterExplain -ccontains $pk -and $toks[0].t -ceq 'WORD' -and $toks[0].v -ceq 'explain'
            if ($p -eq 0 -or ($null -ne $pk -and $spec.DynamicStatementAfter -ccontains $pk) -or $explainPrev) { $an.Acc.Unres('DYNAMIC_SQL', 'a statement whose verb is a dynamic value'); continue }
        }
        if ($t.t -cne 'WORD') { continue }
        $prev = PrgPrevKey $toks $p
        $v = $t.v
        switch -CaseSensitive ($v) {
            'truncate' {
                if ($null -ne $prev -and $spec.TruncateNotAfter -ccontains $prev) { break }
                $start = if (PrgWordAt $toks ($p + 1) 'table') { $p + 2 } else { $p + 1 }
                PrgAnList $an $toks $p $start 'TRUNCATE' $true $true $false
                break
            }
            'drop' { PrgAnDrop $an $toks $p; break }
            'delete' { if (PrgWordAt $toks ($p + 1) 'from') { [void](PrgAnOne $an $toks $p ($p + 2) 'DELETE' $true $true) }; break }
            'insert' { if (PrgWordAt $toks ($p + 1) 'into') { [void](PrgAnOne $an $toks $p ($p + 2) 'INSERT') }; break }
            'merge' { if (PrgWordAt $toks ($p + 1) 'into') { [void](PrgAnOne $an $toks $p ($p + 2) 'MERGE' $true) }; break }
            'update' { PrgAnUpdate $an $toks $p $prev; break }
            'copy' { if (PrgAtStatementStart $toks $p) { PrgAnCopy $an $toks $p }; break }
            'alter' { PrgAnAlter $an $toks $p; break }
            'create' { PrgAnCreate $an $toks $p; break }
            'refresh' {
                if (PrgWordsAt $toks ($p + 1) @('materialized', 'view')) {
                    $start = if (PrgWordAt $toks ($p + 3) 'concurrently') { $p + 4 } else { $p + 3 }
                    [void](PrgAnOne $an $toks $p $start 'REFRESH')
                }
                break
            }
            'reassign' { if ((PrgWordAt $toks ($p + 1) 'owned') -and (PrgAtStatementStart $toks $p)) { $an.Acc.Unres('REASSIGN_OWNED', 'REASSIGN OWNED changes every object a role owns') }; break }
            'import' {
                if (PrgWordsAt $toks ($p + 1) @('foreign', 'schema')) {
                    $into = PrgFindWord $toks ($p + 1) 'into'
                    $name = if ($into -lt 0) { $null } else { (PrgParseNameAt $toks ($into + 1))[0] }
                    if ($null -ne $name -and $null -eq $name.Schema) { PrgAnTarget $an 'IMPORT_FOREIGN_SCHEMA' $name 'SCHEMA' }
                    else { $an.Acc.Unres('IMPORT_FOREIGN_SCHEMA', 'IMPORT FOREIGN SCHEMA without a static local schema') }
                }
                break
            }
            'execute' { PrgAnExecute $an $toks $p $prev; break }
            'into' { PrgAnSelectInto $an $toks $p $prev; break }
            'set' { if (PrgAtStatementStart $toks $p) { PrgAnSetSearchPath $an $toks $p }; break }
            'reset' { if ((PrgAtStatementStart $toks $p) -and ((PrgWordAt $toks ($p + 1) 'search_path') -or (PrgWordAt $toks ($p + 1) 'all'))) { $an.Path = $null }; break }
            'set_config' { PrgAnSetConfig $an $toks $p; break }
            default {
                if ($spec.PostgisFunctions.ContainsKey($v) -and (PrgIsT $toks ($p + 1) 'LPAREN')) { PrgAnPostgis $an $toks $p $spec.PostgisFunctions[$v] }
                elseif ($spec.DynamicExecFunctions -ccontains $v -and (PrgIsT $toks ($p + 1) 'LPAREN')) {
                    $end = PrgMatchParen $toks ($p + 1)
                    $bad = $false
                    for ($k = $p + 2; $k -lt $end; $k++) { $x = $toks[$k]; if (-not ($x.t -ceq 'STRING' -or $x.t -ceq 'COMMA' -or ($x.t -ceq 'OP' -and $x.v -ceq '||'))) { $bad = $true } }
                    if ($bad) { $an.Acc.Unres('DYNAMIC_SQL', "$v() with a non-constant argument runs SQL the text does not contain") }
                }
            }
        }
    }
}

function PrgAnDrop($an, $toks, [int]$p) {
    $spec = Get-ProtectedClassificationSpec
    $ifExists = { param($k) if (PrgWordsAt $toks $k @('if', 'exists')) { $k + 2 } else { $k } }
    $kind = PrgMatchKind $toks ($p + 1) $spec.RelationKinds
    if ($null -ne $kind) { PrgAnList $an $toks $p (& $ifExists ($p + 1 + $kind.Count)) 'DROP'; return }
    if (PrgWordAt $toks ($p + 1) 'schema') { PrgAnList $an $toks $p (& $ifExists ($p + 2)) 'DROP_SCHEMA' $false $false $true; return }
    $unres = PrgMatchKind $toks ($p + 1) $spec.DropUnresolvableKinds
    if ($null -ne $unres) {
        if (PrgAtStatementStart $toks $p) { $an.Acc.Unres('DROP_' + ($unres -join '_').ToUpperInvariant(), "DROP $(($unres -join ' ').ToUpperInvariant()) can drop protected relations no name shows") }
        return
    }
    $nx = PrgGet $toks ($p + 1)
    if ($null -ne $nx -and $nx.t -ceq 'WORD' -and $spec.DropOnKinds -ccontains $nx.v) {
        $named = PrgParseNameAt $toks (& $ifExists ($p + 2))
        if ($null -ne $named[0] -and (PrgWordAt $toks $named[1] 'on')) { [void](PrgAnOne $an $toks $p ($named[1] + 1) 'ALTER' $true) }
        elseif (PrgAtStatementStart $toks $p) { $an.Acc.Unres('ALTER', "DROP $($nx.v.ToUpperInvariant()) without a static ON relation") }
    }
}

function PrgAnUpdate($an, $toks, [int]$p, $prev) {
    if ($null -ne $prev -and (Get-ProtectedClassificationSpec).UpdateNotAfter -ccontains $prev) { return }
    if (PrgWordAt $toks ($p + 1) 'set') { return }
    $r = PrgParseNameAt $toks ($p + 1) $true $true
    $k = $r[1]
    if ($null -ne $r[0]) {
        if (PrgWordAt $toks $k 'as') { $k += 1 }
        if ((PrgIsT $toks $k 'WORD') -and $toks[$k].v -cne 'set') { $k += 1 }
        if (PrgWordAt $toks $k 'set') { PrgAnTarget $an 'UPDATE' $r[0]; return }
    }
    if (PrgAtStatementStart $toks $p) { $an.Acc.Unres('UPDATE', "UPDATE target is not a static relation name: $(PrgDescribeAt $toks $p)") }
}

function PrgAnCopy($an, $toks, [int]$p) {
    if (PrgIsT $toks ($p + 1) 'LPAREN') { return }
    $r = PrgParseNameAt $toks ($p + 1)
    $k = $r[1]
    if ($null -ne $r[0]) {
        if (PrgIsT $toks $k 'LPAREN') { $k = (PrgMatchParen $toks $k) + 1 }
        if (PrgWordAt $toks $k 'from') { PrgAnTarget $an 'COPY_FROM' $r[0] }
        return
    }
    if ((PrgFindWord $toks ($p + 1) 'from') -ge 0) { $an.Acc.Unres('COPY_FROM', "COPY target is not a static relation name: $(PrgDescribeAt $toks $p)") }
}

function PrgAnAlter($an, $toks, [int]$p) {
    $kind = PrgMatchKind $toks ($p + 1) (Get-ProtectedClassificationSpec).RelationKinds
    if ($null -ne $kind) {
        $k = $p + 1 + $kind.Count
        if (PrgWordsAt $toks $k @('if', 'exists')) { $k += 2 }
        if (PrgWordsAt $toks $k @('all', 'in', 'tablespace')) { $an.Acc.Unres('ALTER', 'ALTER ... ALL IN TABLESPACE moves relations no name shows'); return }
        $r = PrgParseNameAt $toks $k $true $true
        if ($null -eq $r[0]) { if (PrgAtStatementStart $toks $p) { $an.Acc.Unres('ALTER', "ALTER target is not a static relation name: $(PrgDescribeAt $toks $p)") }; return }
        $rest = PrgSlice2 $toks $r[1] $toks.Count
        $renameAt = -1
        for ($n = 0; $n -lt $rest.Count; $n++) { if ($rest[$n].t -ceq 'WORD' -and $rest[$n].v -ceq 'rename' -and (PrgWordAt $rest ($n + 1) 'to')) { $renameAt = $n; break } }
        if ($renameAt -ge 0) {
            $to = (PrgParseNameAt $rest ($renameAt + 2))[0]
            PrgAnTarget $an 'RENAME' $r[0]
            if ($null -ne $to) { PrgAnTarget $an 'RENAME' ([PrgName]::new($r[0].Schema, $to.Table)) } else { $an.Acc.Unres('RENAME', 'RENAME TO a name that is not static') }
            return
        }
        PrgAnTarget $an 'ALTER' $r[0]
        $setAt = -1
        for ($n = 0; $n -lt $rest.Count; $n++) { if ($rest[$n].t -ceq 'WORD' -and $rest[$n].v -ceq 'set' -and (PrgWordAt $rest ($n + 1) 'schema')) { $setAt = $n; break } }
        if ($setAt -ge 0) {
            $dest = (PrgParseNameAt $rest ($setAt + 2))[0]
            if ($null -ne $dest -and $null -eq $dest.Schema) { PrgAnTarget $an 'ALTER' ([PrgName]::new($dest.Table, $r[0].Table)) } else { $an.Acc.Unres('ALTER', 'SET SCHEMA to a schema that is not static') }
        }
        return
    }
    if (PrgWordAt $toks ($p + 1) 'schema') {
        $r = PrgParseNameAt $toks ($p + 2)
        if ($null -eq $r[0] -or $null -ne $r[0].Schema) { if (PrgAtStatementStart $toks $p) { $an.Acc.Unres('ALTER_SCHEMA', "ALTER SCHEMA target is not a static schema name: $(PrgDescribeAt $toks $p)") }; return }
        if (PrgWordsAt $toks $r[1] @('rename', 'to')) {
            $to = (PrgParseNameAt $toks ($r[1] + 2))[0]
            PrgAnTarget $an 'RENAME_SCHEMA' $r[0] 'SCHEMA'
            if ($null -ne $to -and $null -eq $to.Schema) { PrgAnTarget $an 'RENAME_SCHEMA' $to 'SCHEMA' } else { $an.Acc.Unres('RENAME_SCHEMA', 'RENAME TO a schema name that is not static') }
        } else { PrgAnTarget $an 'ALTER_SCHEMA' $r[0] 'SCHEMA' }
    }
}

function PrgAnCreate($an, $toks, [int]$p) {
    $spec = Get-ProtectedClassificationSpec
    $k = $p + 1
    $orReplace = $false
    if (PrgWordsAt $toks $k @('or', 'replace')) { $orReplace = $true; $k += 2 }
    while ((PrgIsT $toks $k 'WORD') -and $spec.CreateModifiers -ccontains $toks[$k].v) { $k += 1 }
    $kind = PrgMatchKind $toks $k $spec.RelationKinds
    if ($null -ne $kind) {
        $k += $kind.Count
        if (PrgWordsAt $toks $k @('if', 'not', 'exists')) { $k += 3 }
        $r = PrgParseNameAt $toks $k
        if ($null -eq $r[0]) { if (PrgAtStatementStart $toks $p) { $an.Acc.Unres('CREATE', "CREATE target is not a static relation name: $(PrgDescribeAt $toks $p)") }; return }
        PrgAnTarget $an $(if ($orReplace) { 'CREATE_OR_REPLACE' } else { 'CREATE' }) $r[0]
        $rest = PrgSlice2 $toks $r[1] $toks.Count
        $partitionOf = -1
        for ($n = 0; $n -lt $rest.Count; $n++) { if ($rest[$n].t -ceq 'WORD' -and $rest[$n].v -ceq 'partition' -and (PrgWordAt $rest ($n + 1) 'of')) { $partitionOf = $n; break } }
        if ($partitionOf -ge 0) {
            $parent = (PrgParseNameAt $rest ($partitionOf + 2))[0]
            if ($null -ne $parent) { PrgAnTarget $an 'ALTER' $parent } else { $an.Acc.Unres('ALTER', 'PARTITION OF a parent that is not static') }
        }
        $inherits = -1
        for ($n = 0; $n -lt $rest.Count; $n++) { if ($rest[$n].t -ceq 'WORD' -and $rest[$n].v -ceq 'inherits' -and (PrgIsT $rest ($n + 1) 'LPAREN')) { $inherits = $n; break } }
        if ($inherits -ge 0) {
            $n = $inherits + 2
            while ($true) {
                $pr = PrgParseNameAt $rest $n
                if ($null -eq $pr[0]) { $an.Acc.Unres('ALTER', 'INHERITS a parent that is not static'); break }
                PrgAnTarget $an 'ALTER' $pr[0]
                if (-not (PrgIsT $rest $pr[1] 'COMMA')) { break }
                $n = $pr[1] + 1
            }
        }
        return
    }
    if ((PrgWordAt $toks $k 'constraint') -and (PrgWordAt $toks ($k + 1) 'trigger')) { $k += 1 }
    $obj = if (PrgIsT $toks $k 'WORD') { $toks[$k].v } else { $null }
    if ('trigger', 'policy', 'rule' -ccontains $obj) {
        $anchor = if ($obj -ceq 'rule') { 'to' } else { 'on' }
        $at = PrgFindWord $toks ($k + 2) $anchor
        $name = if ($at -lt 0) { $null } else { (PrgParseNameAt $toks ($at + 1) $true)[0] }
        if ($null -ne $name) { PrgAnTarget $an 'ALTER' $name }
        elseif (PrgAtStatementStart $toks $p) { $an.Acc.Unres('ALTER', "CREATE $($obj.ToUpperInvariant()) on a relation that is not static") }
    }
}

function PrgAnExecute($an, $toks, [int]$p, $prev) {
    $spec = Get-ProtectedClassificationSpec
    if ($null -ne $prev -and $spec.ExecuteNotAfter -ccontains $prev) { return }
    $nx = PrgGet $toks ($p + 1)
    if ($null -ne $nx -and $nx.t -ceq 'WORD' -and $spec.ExecuteNotBefore -ccontains $nx.v) { return }
    if (-not (PrgAtStatementStart $toks $p)) { return }
    $expr = [System.Collections.Generic.List[PrgTok]]::new()
    for ($k = $p + 1; $k -lt $toks.Count; $k++) { $x = $toks[$k]; if ($x.t -ceq 'WORD' -and ($x.v -ceq 'using' -or $x.v -ceq 'into')) { break }; $expr.Add($x) }
    $constant = $expr.Count -gt 0
    for ($n = 0; $n -lt $expr.Count; $n++) {
        $x = $expr[$n]
        $ok = if ($n % 2 -eq 0) { $x.t -ceq 'STRING' } else { $x.t -ceq 'OP' -and $x.v -ceq '||' }
        if (-not $ok) { $constant = $false }
    }
    if (-not $constant) { $an.Acc.Unres('DYNAMIC_SQL', "EXECUTE of a non-constant expression: $(PrgDescribeAt $toks $p)") }
}

function PrgAnSelectInto($an, $toks, [int]$p, $prev) {
    if ($prev -ceq 'insert' -or $prev -ceq 'merge') { return }
    $seen = $false
    for ($k = 0; $k -lt $p; $k++) { if ($toks[$k].t -ceq 'WORD' -and $toks[$k].v -ceq 'select') { $seen = $true } }
    if (-not $seen) { return }
    $k = $p + 1
    while ((PrgIsT $toks $k 'WORD') -and ('temp', 'temporary', 'unlogged', 'table' -ccontains $toks[$k].v)) { $k += 1 }
    $name = (PrgParseNameAt $toks $k)[0]
    if ($null -ne $name) { PrgAnTarget $an 'CREATE' $name }
}

function PrgAnSetSearchPath($an, $toks, [int]$p) {
    $k = $p + 1
    if ((PrgWordAt $toks $k 'session') -or (PrgWordAt $toks $k 'local')) { $k += 1 }
    if (PrgWordAt $toks $k 'schema') { $an.Path = PrgPathValues (PrgSlice2 $toks ($k + 1) $toks.Count); return }
    if (-not (PrgWordAt $toks $k 'search_path')) { return }
    $k += 1
    if ((PrgWordAt $toks $k 'to') -or ((PrgIsT $toks $k 'OP') -and $toks[$k].v -ceq '=')) { $k += 1 }
    $an.Path = PrgPathValues (PrgSlice2 $toks $k $toks.Count)
}

function PrgAnSetConfig($an, $toks, [int]$p) {
    if (-not (PrgIsT $toks ($p + 1) 'LPAREN')) { return }
    $end = PrgMatchParen $toks ($p + 1)
    $argList = PrgSplitArgs (PrgSlice2 $toks ($p + 2) $end)
    $first = if ($argList.Count -gt 0) { $argList[0] } else { $null }
    if ($null -eq $first -or $first.Count -ne 1 -or $first[0].t -cne 'STRING') {
        if ($null -ne $first) { foreach ($x in $first) { if ($x.t -cne 'STRING') { $an.Path = 'UNKNOWN'; break } } }
        return
    }
    if ((PrgLower $first[0].v.Trim()) -cne 'search_path') { return }
    $second = if ($argList.Count -gt 1) { $argList[1] } else { $null }
    if ($null -ne $second -and $second.Count -eq 1 -and $second[0].t -ceq 'STRING') { $an.Path = PrgPathValues $second } else { $an.Path = 'UNKNOWN' }
}

function PrgAnPostgis($an, $toks, [int]$p, [string]$op) {
    $end = PrgMatchParen $toks ($p + 1)
    $argList = [System.Collections.Generic.List[object]]::new()
    foreach ($a in (PrgSplitArgs (PrgSlice2 $toks ($p + 2) $end))) {
        $n = $a.Count
        while ($n -ge 2 -and $a[$n - 2].t -ceq 'OP' -and $a[$n - 2].v -ceq '::' -and $a[$n - 1].t -ceq 'WORD') { $n -= 2 }
        $argList.Add((PrgSlice2 $a 0 $n))
    }
    $bad = $argList.Count -eq 0
    $dynOpen = (Get-ProtectedClassificationSpec).Open
    foreach ($a in $argList) { if ($a.Count -ne 1 -or ($a[0].t -cne 'STRING' -and $a[0].t -cne 'NUMBER') -or ([string]$a[0].v).Contains($dynOpen, [StringComparison]::Ordinal)) { $bad = $true } }
    if ($bad) { $an.Acc.Unres($op, "$($toks[$p].v)() without constant arguments: the relation it changes is not static"); return }
    $strings = [System.Collections.Generic.List[string]]::new()
    foreach ($a in $argList) { if ($a[0].t -ceq 'STRING') { $strings.Add($a[0].v) } }
    foreach ($s in $strings) { $name = ConvertTo-ProtectedRelationName $s; if ($null -ne $name) { PrgAnTarget $an $op $name } }
    for ($n = 0; $n + 1 -lt $strings.Count; $n++) { PrgAnTarget $an $op ([PrgName]::new($strings[$n], $strings[$n + 1])) }
}

function PrgPathKey($path) { if ($null -eq $path) { return 'null' }; if ($path -is [string]) { return "s:$path" }; return 'a:' + ($path -join "`u{1}") }

# Returns @([PrgAcc], [bool] searchPathChanged)
function PrgAnalyzeSqlAt([string]$sql, [int]$depth) {
    $spec = Get-ProtectedClassificationSpec
    $acc = [PrgAcc]::new()
    $tk = PrgTokenizeSql $sql
    if ($null -ne $tk[1]) { $acc.Unres('PARSE', "$($tk[1]): the text cannot be read as SQL"); return , @($acc, $false) }
    $toks = $tk[0]
    $nestedChanged = $false
    $dyn = "$($spec.Open)$($spec.Close)"
    foreach ($text in (PrgEmbeddedTexts $toks $dyn)) {
        if ($depth + 1 -gt $spec.MaxNesting) { $acc.Unres('DYNAMIC_SQL', 'SQL nested in literals deeper than the classifier reads'); continue }
        $nested = PrgAnalyzeSqlAt $text ($depth + 1)
        $acc.Merge($nested[0])
        if ($nested[1]) { $nestedChanged = $true }
    }
    $an = @{ Acc = [PrgAcc]::new(); Path = $(if ($nestedChanged) { 'UNKNOWN' } else { $null }) }
    $changed = $nestedChanged
    foreach ($statement in (PrgSplitStatements $toks)) {
        $before = PrgPathKey $an.Path
        PrgAnStatement $an $statement
        if ((PrgPathKey $an.Path) -cne $before) { $changed = $true }
    }
    $acc.Merge($an.Acc)
    return , @($acc, $changed)
}

function PrgAnalyzeSql([string]$sql) { return (PrgAnalyzeSqlAt $sql 0)[0] }

# ---------------------------------------------------------------------------------------------------------------
# ogr2ogr
# ---------------------------------------------------------------------------------------------------------------

function PrgFlagValues([string[]]$argv, [string[]]$flags, [bool]$ignoreCase = $false) {
    $values = [System.Collections.Generic.List[string]]::new()
    for ($i = 0; $i -lt $argv.Count; $i++) {
        $key = if ($ignoreCase) { PrgLower $argv[$i].Trim() } else { $argv[$i].Trim() }
        if ($flags -cnotcontains $key) { continue }
        if ($i + 1 -lt $argv.Count) { $values.Add($argv[$i + 1]) }
    }
    return , $values
}

function PrgIsPgDatasource([string]$a) {
    $lower = PrgLower $a.Trim()
    foreach ($p in (Get-ProtectedClassificationSpec).OgrPrefixes) { if ($lower.StartsWith($p, [StringComparison]::Ordinal)) { return $true } }
    return $false
}

function PrgOptionValues([string]$text, [string[]]$keys) {
    $out = [System.Collections.Generic.List[string]]::new()
    foreach ($m in [regex]::Matches($text, '([A-Za-z_]+)\s*=\s*(''([^'']*)''|"([^"]*)"|([^\s''"]+))')) {
        if ($keys -ccontains (PrgLower $m.Groups[1].Value)) {
            if ($m.Groups[3].Success) { $out.Add($m.Groups[3].Value) } elseif ($m.Groups[4].Success) { $out.Add($m.Groups[4].Value) } else { $out.Add($m.Groups[5].Value) }
        }
    }
    return , $out
}

# Returns @([PrgAcc], [bool] database)
function PrgAnalyzeOgr2ogr([string[]]$argv) {
    $spec = Get-ProtectedClassificationSpec
    $acc = [PrgAcc]::new()
    $formats = @(foreach ($f in (PrgFlagValues $argv $spec.OgrFormatFlags $true)) { PrgLower $f.Trim() })
    foreach ($sqlText in (PrgFlagValues $argv $spec.OgrSqlFlags $true)) {
        if ($sqlText.Trim().StartsWith('@', [StringComparison]::Ordinal)) { $acc.Unres('DYNAMIC_SQL', 'ogr2ogr -sql @file runs SQL the arguments do not contain') }
        else { $acc.Merge((PrgAnalyzeSql $sqlText)) }
    }
    $pgSources = @($argv | Where-Object { PrgIsPgDatasource $_ })
    $nln = PrgFlagValues $argv $spec.OgrLayerNameFlags $true
    $dynamicOnly = $false
    foreach ($a in $argv) { if ($null -ne (PrgDynamicHint $a)) { $dynamicOnly = $true } }
    if ($formats.Count -gt 0) {
        $database = $false
        foreach ($f in $formats) { if ($spec.OgrDatabaseFormats -ccontains $f -or $spec.OgrDumpFormats -ccontains $f -or $null -ne (PrgDynamicHint $f)) { $database = $true } }
    } else { $database = $pgSources.Count -gt 0 -or ($dynamicOnly -and $nln.Count -gt 0) }
    if (-not $database) { return , @($acc, $false) }
    if ($nln.Count -eq 0) { $acc.Unres('OGR2OGR_WRITE', 'a PostgreSQL ogr2ogr write without -nln takes its table name from the source'); return , @($acc, $true) }
    $schemas = [System.Collections.Generic.List[string]]::new()
    foreach ($v in (PrgFlagValues $argv $spec.OgrLcoFlags $true)) { foreach ($s in (PrgOptionValues $v $spec.OgrSchemaOptions)) { $schemas.Add($s) } }
    foreach ($v in (PrgFlagValues $argv $spec.OgrDooFlags $true)) { foreach ($s in (PrgOptionValues $v $spec.OgrActiveSchemaOptions)) { foreach ($x in $s.Split(',')) { $schemas.Add($x) } } }
    foreach ($ds in $pgSources) { foreach ($s in (PrgOptionValues $ds $spec.OgrActiveSchemaOptions)) { foreach ($x in $s.Split(',')) { $schemas.Add($x) } } }
    foreach ($value in $nln) {
        $name = ConvertTo-ProtectedRelationName $value
        if ($null -eq $name) { $acc.Unres('OGR2OGR_WRITE', "-nln $value is not a static relation name"); continue }
        $acc.Target('OGR2OGR_WRITE', 'RELATION', $name)
        if ($null -ne $name.Schema) { continue }
        foreach ($raw in $schemas) {
            $schema = ConvertTo-ProtectedRelationName $raw
            if ($null -eq $schema -or $null -ne $schema.Schema) { $acc.Unres('OGR2OGR_WRITE', "schema $raw is not a static schema name"); continue }
            $acc.Target('OGR2OGR_WRITE', 'RELATION', [PrgName]::new($schema.Table, $name.Table))
        }
    }
    return , @($acc, $true)
}

# ---------------------------------------------------------------------------------------------------------------
# Command lines
# ---------------------------------------------------------------------------------------------------------------

function PrgReadVariable([string]$s, [int]$i) {
    $c1 = PrgAt $s ($i + 1)
    if ($c1 -ceq '(') {
        $depth = 0
        for ($j = $i + 1; $j -lt $s.Length; $j++) {
            if ([string]$s[$j] -ceq '(') { $depth += 1 }
            elseif ([string]$s[$j] -ceq ')') { $depth -= 1; if ($depth -eq 0) { return , @((PrgDyn ''), ($j + 1)) } }
        }
        return , @((PrgDyn ''), $s.Length)
    }
    if ($c1 -ceq '{') {
        $end = PrgIndexOf $s '}' ($i + 2)
        if ($end -lt 0) { return , @((PrgDyn (PrgSlice $s ($i + 2) $s.Length)), $s.Length) }
        return , @((PrgDyn (PrgSlice $s ($i + 2) $end)), ($end + 1))
    }
    $m = [regex]::Match((PrgSlice $s ($i + 1) $s.Length), '^[A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)?')
    if ($m.Success) { return , @((PrgDyn ([regex]::Replace($m.Value, '^(?i:env):', ''))), ($i + 1 + $m.Value.Length)) }
    return $null
}

function Split-ProtectedCommandLine([string]$Command) {
    $pipelines = [System.Collections.Generic.List[object]]::new()
    $st = @{ pipeline = [System.Collections.Generic.List[object]]::new(); argv = [System.Collections.Generic.List[string]]::new(); stdin = $null; stdinFile = $null
        tok = [System.Text.StringBuilder]::new(); started = $false; heredoc = $null; expectStdinFile = $false; skipNext = $false }
    $endToken = {
        if ($st.started) {
            if ($st.skipNext) { $st.skipNext = $false }
            elseif ($st.expectStdinFile) { $st.stdinFile = $st.tok.ToString(); $st.expectStdinFile = $false }
            else { $st.argv.Add($st.tok.ToString()) }
        }
        [void]$st.tok.Clear(); $st.started = $false
    }
    $endSegment = {
        & $endToken
        if ($st.argv.Count -gt 0 -or $null -ne $st.stdin) { $st.pipeline.Add([pscustomobject]@{ argv = [string[]]$st.argv.ToArray(); stdin = $st.stdin; stdinFile = $st.stdinFile }) }
        $st.argv = [System.Collections.Generic.List[string]]::new(); $st.stdin = $null; $st.stdinFile = $null
    }
    $endPipeline = {
        & $endSegment
        if ($st.pipeline.Count -gt 0) { $pipelines.Add($st.pipeline) }
        $st.pipeline = [System.Collections.Generic.List[object]]::new()
    }
    $s = $Command
    $n = $s.Length
    $i = 0
    while ($i -lt $n) {
        $c = [string]$s[$i]
        $c1 = PrgAt $s ($i + 1)
        if ($c -ceq "'") {
            $end = PrgIndexOf $s "'" ($i + 1)
            [void]$st.tok.Append((PrgSlice $s ($i + 1) $(if ($end -lt 0) { $n } else { $end })))
            $st.started = $true; $i = if ($end -lt 0) { $n } else { $end + 1 }; continue
        }
        if ($c -ceq '"') {
            $j = $i + 1
            while ($j -lt $n -and [string]$s[$j] -cne '"') {
                $cj = [string]$s[$j]; $cj1 = PrgAt $s ($j + 1)
                if (($cj -ceq '\' -or $cj -ceq '`') -and ('"', '\', '`', '$' -ccontains $cj1)) { [void]$st.tok.Append($cj1); $j += 2; continue }
                if ($cj -ceq '$') { $v = PrgReadVariable $s $j; if ($null -ne $v) { [void]$st.tok.Append($v[0]); $j = $v[1]; continue } }
                if ($cj -ceq '%') {
                    $m = [regex]::Match((PrgSlice $s $j $n), '^%([A-Za-z_][A-Za-z0-9_]*)%')
                    if ($m.Success) { [void]$st.tok.Append((PrgDyn $m.Groups[1].Value)); $j += $m.Value.Length; continue }
                }
                [void]$st.tok.Append($cj); $j += 1
            }
            $st.started = $true; $i = $j + 1; continue
        }
        if ($c -ceq '@' -and ($c1 -ceq "'" -or $c1 -ceq '"') -and -not $st.started -and ((PrgAt $s ($i + 2)) -ceq "`n" -or (PrgSlice $s ($i + 2) ($i + 4)) -ceq "`r`n")) {
            $closer = "`n$c1@"
            $end = PrgIndexOf $s $closer ($i + 2)
            $body = PrgSlice $s ((PrgIndexOf $s "`n" $i) + 1) $(if ($end -lt 0) { $n } else { $end })
            $body = [regex]::Replace($body, '\r\z', '')
            if ($c1 -ceq '"') { $body = [regex]::Replace($body, '\$\{?[A-Za-z_][A-Za-z0-9_:]*\}?', { param($m) PrgDyn ([regex]::Replace($m.Value, '[${}]', '')) }) }
            [void]$st.tok.Append($body)
            $st.started = $true; $i = if ($end -lt 0) { $n } else { $end + $closer.Length }; continue
        }
        if (('\', '`', '^' -ccontains $c) -and ($c1 -ceq "`n" -or ($c1 -ceq "`r" -and (PrgAt $s ($i + 2)) -ceq "`n"))) { $i += $(if ($c1 -ceq "`r") { 3 } else { 2 }); continue }
        if ($c -ceq "`n" -or $c -ceq "`r") {
            if ($null -ne $st.heredoc) {
                $delim = $st.heredoc; $st.heredoc = $null
                $lines = (PrgSlice $s ($i + 1) $n).Split("`n")
                $body = [System.Collections.Generic.List[string]]::new()
                $consumed = $i + 1; $found = $false
                foreach ($line in $lines) {
                    $consumed += $line.Length + 1
                    $clean = [regex]::Replace($line, '\r\z', '')
                    if ($clean.Trim() -ceq $delim) { $found = $true; break }
                    $body.Add($clean)
                }
                $st.stdin = $body -join "`n"
                & $endPipeline
                $i = if ($found) { $consumed } else { $n }; continue
            }
            & $endPipeline; $i += 1; continue
        }
        if ($c -ceq ' ' -or $c -ceq "`t") { & $endToken; $i += 1; continue }
        if ($c -ceq '|') { if ($c1 -ceq '|') { & $endPipeline; $i += 2 } else { & $endSegment; $i += 1 }; continue }
        if ($c -ceq '&') {
            if ($c1 -ceq '&') { & $endPipeline; $i += 2; continue }
            if (-not $st.started -and $st.argv.Count -eq 0) { $i += 1; continue }
            & $endPipeline; $i += 1; continue
        }
        if ($c -ceq ';') { & $endPipeline; $i += 1; continue }
        if ($c -ceq '<') {
            & $endToken
            if ($c1 -ceq '<') {
                $m = [regex]::Match((PrgSlice $s $i $n), '^<<-?\s*([''"]?)([A-Za-z_][A-Za-z0-9_]*)\1')
                if ($m.Success) { $st.heredoc = $m.Groups[2].Value; $i += $m.Value.Length; continue }
                $i += 2; continue
            }
            $st.expectStdinFile = $true; $i += 1; continue
        }
        if ($c -ceq '>') {
            if ($st.tok.ToString() -cmatch '^[0-9]+\z') { [void]$st.tok.Clear(); $st.started = $false }
            & $endToken
            $j = $i + 1
            if ((PrgAt $s $j) -ceq '>') { $j += 1 }
            if ((PrgAt $s $j) -ceq '&') { $j += 1; while ($j -lt $n -and (PrgIsDigit ([string]$s[$j]))) { $j += 1 } }
            else { $st.skipNext = $true }
            $i = $j; continue
        }
        if ($c -ceq '$') { $v = PrgReadVariable $s $i; if ($null -ne $v) { [void]$st.tok.Append($v[0]); $st.started = $true; $i = $v[1]; continue } }
        if ($c -ceq '%') {
            $m = [regex]::Match((PrgSlice $s $i $n), '^%([A-Za-z_][A-Za-z0-9_]*)%')
            if ($m.Success) { [void]$st.tok.Append((PrgDyn $m.Groups[1].Value)); $st.started = $true; $i += $m.Value.Length; continue }
        }
        [void]$st.tok.Append($c); $st.started = $true; $i += 1
    }
    & $endPipeline
    return , $pipelines
}

function PrgToolBaseName([string]$a) {
    $t = [regex]::Replace($a.Trim(), '^["'']+|["'']+\z', '')
    $parts = [regex]::Split($t, '[\\/]')
    return PrgLower $parts[$parts.Count - 1]
}

function PrgToolOf([string]$a) {
    $spec = Get-ProtectedClassificationSpec
    $hint = PrgDynamicHint $a
    $names = @($spec.Tools.Keys) | Sort-Object -Property @{ Expression = { $_.Length }; Descending = $true }, @{ Expression = { $_ }; Descending = $false } -CaseSensitive
    if ($null -ne $hint) {
        $h = PrgLower $hint
        foreach ($name in $names) {
            $bare = [regex]::Replace($name, '\.py\z', '')
            if ($spec.Tools[$name] -cne 'GDAL' -and $spec.Tools[$name] -cne 'PRISMA' -and $h.Contains($bare)) { return $spec.Tools[$name] }
        }
        return $null
    }
    $base = PrgToolBaseName $a
    if ($spec.Tools.ContainsKey($base)) { return $spec.Tools[$base] }
    foreach ($suffix in $spec.ToolSuffixes) {
        if ($base.EndsWith($suffix, [StringComparison]::Ordinal)) {
            $stem = $base.Substring(0, $base.Length - $suffix.Length)
            if ($spec.Tools.ContainsKey($stem)) { return $spec.Tools[$stem] }
        }
    }
    return $null
}

function PrgWrapper([string]$a) {
    $spec = Get-ProtectedClassificationSpec
    $base = PrgToolBaseName $a
    foreach ($suffix in $spec.ToolSuffixes) { if ($base.EndsWith($suffix, [StringComparison]::Ordinal)) { $base = $base.Substring(0, $base.Length - $suffix.Length) } }
    if ($spec.Wrappers.ContainsKey($base)) { return [pscustomobject]@{ Flags = $spec.Wrappers[$base]; RestOfLine = ($spec.WrappersRestOfLine -ccontains $base) } }
    return $null
}

function PrgRequote([string]$a) {
    if ($a -notmatch '[\s"''`$\\]') { return $a }
    $sb = [System.Text.StringBuilder]::new()
    foreach ($ch in $a.ToCharArray()) { $c = [string]$ch; if ('"', '\', '`', '$' -ccontains $c) { [void]$sb.Append('\') }; [void]$sb.Append($c) }
    return '"' + $sb.ToString() + '"'
}

$script:PrgGenerators = @('SHP2PGSQL', 'PG_DUMP', 'PG_RESTORE', 'OGR2OGR')

function PrgReadFileOrUnresolved([PrgAcc]$acc, [string]$path, $readSqlFile, [int]$depth) {
    $text = $null
    if (-not (PrgContainsDynamic $path) -and $null -ne $readSqlFile) { $text = & $readSqlFile $path }
    if ($null -eq $text) { $acc.Unres('PSQL_FILE', "SQL file $path is not available to the classifier"); return }
    if ($depth -gt (Get-ProtectedClassificationSpec).MaxNesting) { $acc.Unres('PARSE', 'nesting'); return }
    $acc.Merge((PrgAnalyzeSql $text))
}

function PrgPgObjectTargets([PrgAcc]$acc, [string[]]$rest, [string]$what) {
    $spec = Get-ProtectedClassificationSpec
    $collect = {
        param([string[]]$flags)
        $values = [System.Collections.Generic.List[string]]::new()
        foreach ($x in (PrgFlagValues $rest $flags)) { $values.Add($x) }
        foreach ($a in $rest) { foreach ($f in $flags) { if ($f.StartsWith('--', [StringComparison]::Ordinal) -and (PrgLower $a).StartsWith("$f=", [StringComparison]::Ordinal)) { $values.Add($a.Substring($f.Length + 1)) } } }
        , $values
    }
    $tables = & $collect $spec.RestoreTableFlags
    $schemas = & $collect $spec.RestoreSchemaFlags
    foreach ($a in $rest) { if ($spec.RestoreListFileFlags -ccontains $a) { $acc.Unres('RESTORE', "$what with a list file restores objects the arguments do not name"); return } }
    if ($tables.Count -gt 0) {
        foreach ($t in $tables) {
            $name = ConvertTo-ProtectedRelationName $t
            if ($null -eq $name) { $acc.Unres('RESTORE', "$what table $t is not a static name"); continue }
            if ($null -ne $name.Schema -or $schemas.Count -eq 0) { $acc.Target('RESTORE', 'RELATION', $name) }
            if ($null -eq $name.Schema) {
                foreach ($s in $schemas) {
                    $schema = ConvertTo-ProtectedRelationName $s
                    if ($null -eq $schema -or $null -ne $schema.Schema) { $acc.Unres('RESTORE', "$what schema $s is not static") }
                    else { $acc.Target('RESTORE', 'RELATION', [PrgName]::new($schema.Table, $name.Table)) }
                }
            }
        }
        return
    }
    if ($schemas.Count -gt 0) {
        foreach ($s in $schemas) {
            $schema = ConvertTo-ProtectedRelationName $s
            if ($null -eq $schema -or $null -ne $schema.Schema) { $acc.Unres('RESTORE_SCHEMA', "$what schema $s is not static") }
            else { $acc.Target('RESTORE_SCHEMA', 'SCHEMA', [PrgName]::new($null, $schema.Table)) }
        }
        return
    }
    $acc.Unres('RESTORE', "$what without -t/-n writes every object of the archive")
}

function PrgAnalyzeTool([string]$tool, [string[]]$rest, $ctx, $readSqlFile, [int]$depth) {
    $spec = Get-ProtectedClassificationSpec
    $acc = [PrgAcc]::new()
    switch -CaseSensitive ($tool) {
        'OGR2OGR' { return (PrgAnalyzeOgr2ogr $rest)[0] }
        'OGRINFO' {
            foreach ($v in (PrgFlagValues $rest $spec.OgrinfoSqlFlags $true)) {
                if ($v.Trim().StartsWith('@', [StringComparison]::Ordinal)) { $acc.Unres('DYNAMIC_SQL', 'ogrinfo -sql @file') } else { $acc.Merge((PrgAnalyzeSql $v)) }
            }
            return $acc
        }
        'PSQL' {
            $hasSql = $false
            $i = 0
            while ($i -lt $rest.Count) {
                $a = $rest[$i]
                if ($spec.PsqlCommandFlags -ccontains $a) {
                    $hasSql = $true
                    if ($i + 1 -lt $rest.Count) { $acc.Merge((PrgAnalyzeSql $rest[$i + 1])) } else { $acc.Unres('PSQL_STDIN', 'psql -c without a command') }
                    $i += 2; continue
                }
                if ($a.StartsWith('--command=', [StringComparison]::Ordinal)) { $hasSql = $true; $acc.Merge((PrgAnalyzeSql $a.Substring(10))) }
                elseif ($spec.PsqlFileFlags -ccontains $a) {
                    $hasSql = $true
                    if ($i + 1 -lt $rest.Count) { PrgReadFileOrUnresolved $acc $rest[$i + 1] $readSqlFile $depth } else { $acc.Unres('PSQL_FILE', 'psql -f without a file') }
                    $i += 2; continue
                }
                elseif ($a.StartsWith('--file=', [StringComparison]::Ordinal)) { $hasSql = $true; PrgReadFileOrUnresolved $acc $a.Substring(7) $readSqlFile $depth }
                elseif ($spec.PsqlValueFlags -ccontains $a) { $i += 2; continue }
                $i += 1
            }
            if (-not $hasSql) {
                if ($null -ne $ctx.stdin) { $acc.Merge((PrgAnalyzeSql $ctx.stdin)) }
                elseif ($null -ne $ctx.stdinFile) { PrgReadFileOrUnresolved $acc $ctx.stdinFile $readSqlFile $depth }
                elseif ($null -eq $ctx.pipedFrom -or $script:PrgGenerators -cnotcontains $ctx.pipedFrom) { $acc.Unres('PSQL_STDIN', 'psql reads SQL from stdin that the command line does not contain') }
            }
            return $acc
        }
        'PG_RESTORE' {
            foreach ($a in $rest) { if ($spec.RestoreListOnlyFlags -ccontains $a) { return $acc } }
            PrgPgObjectTargets $acc $rest 'pg_restore'
            return $acc
        }
        'PG_DUMP' { if ($ctx.pipesTo -ceq 'PSQL') { PrgPgObjectTargets $acc $rest 'pg_dump | psql' }; return $acc }
        'SHP2PGSQL' {
            $positionals = [System.Collections.Generic.List[string]]::new()
            $i = 0
            while ($i -lt $rest.Count) {
                $a = $rest[$i]
                if ($a.StartsWith('-', [StringComparison]::Ordinal) -and $a.Length -gt 1) { if ($spec.ShpValueFlags -ccontains $a) { $i += 1 }; $i += 1; continue }
                $positionals.Add($a); $i += 1
            }
            if ($positionals.Count -lt 2) { $acc.Unres('SHP2PGSQL_WRITE', 'shp2pgsql/raster2pgsql without a table takes the name from the file'); return $acc }
            $name = ConvertTo-ProtectedRelationName $positionals[1]
            if ($null -ne $name) { $acc.Target('SHP2PGSQL_WRITE', 'RELATION', $name) } else { $acc.Unres('SHP2PGSQL_WRITE', "table $($positionals[1]) is not a static name") }
            return $acc
        }
        'GDAL' {
            foreach ($a in $rest) { if (PrgIsPgDatasource $a) { $acc.Unres('COMMAND', 'a GDAL tool with a PostgreSQL datasource writes relations the arguments do not name'); break } }
            return $acc
        }
        'PRISMA' {
            $words = @($rest | Where-Object { -not $_.StartsWith('-', [StringComparison]::Ordinal) } | ForEach-Object { PrgLower $_ })
            foreach ($sub in $spec.PrismaUnresolvable) {
                $hit = $true
                for ($n = 0; $n -lt $sub.Count; $n++) { if ($n -ge $words.Count -or $words[$n] -cne $sub[$n]) { $hit = $false } }
                if ($hit) { $acc.Unres('COMMAND', "prisma $($sub -join ' ') changes the database outside any classified SQL"); return $acc }
            }
            foreach ($sub in $spec.PrismaFileExecuting) {
                $hit = $true
                for ($n = 0; $n -lt $sub.Count; $n++) { if ($n -ge $words.Count -or $words[$n] -cne $sub[$n]) { $hit = $false } }
                if (-not $hit) { continue }
                foreach ($a in $rest) { if ($spec.PrismaStdinFlags -ccontains (PrgLower $a)) { $acc.Unres('PSQL_STDIN', "prisma $($sub -join ' ') --stdin"); return $acc } }
                $files = [System.Collections.Generic.List[string]]::new()
                foreach ($x in (PrgFlagValues $rest $spec.PrismaFileFlags)) { $files.Add($x) }
                foreach ($a in $rest) { if ((PrgLower $a).StartsWith('--file=', [StringComparison]::Ordinal)) { $files.Add($a.Substring(7)) } }
                if ($files.Count -eq 0) { $acc.Unres('PSQL_FILE', "prisma $($sub -join ' ') without --file") }
                foreach ($f in $files) { PrgReadFileOrUnresolved $acc $f $readSqlFile $depth }
                return $acc
            }
            return $acc
        }
    }
    return $acc
}

function PrgAnalyzeArgvAt([string[]]$argv, $ctx, $readSqlFile, [int]$depth) {
    $spec = Get-ProtectedClassificationSpec
    $acc = [PrgAcc]::new()
    if ($depth -gt $spec.MaxNesting) { $acc.Unres('COMMAND', 'command nesting deeper than the classifier reads'); return $acc }
    for ($k = 0; $k -lt $argv.Count; $k++) {
        $wrapper = PrgWrapper $argv[$k]
        if ($null -ne $wrapper) {
            $at = -1
            for ($n = $k + 1; $n -lt $argv.Count; $n++) { if ($wrapper.Flags -ccontains (PrgLower $argv[$n])) { $at = $n; break } }
            if ($at -ge 0 -and $at + 1 -lt $argv.Count) {
                $command = if ($wrapper.RestOfLine) { (@($argv[($at + 1)..($argv.Count - 1)] | ForEach-Object { PrgRequote $_ })) -join ' ' } else { $argv[$at + 1] }
                return (PrgAnalyzeCommandAt $command $readSqlFile ($depth + 1))
            }
            continue
        }
        $tool = PrgToolOf $argv[$k]
        if ($null -ne $tool) {
            $rest = if ($k + 1 -lt $argv.Count) { [string[]]$argv[($k + 1)..($argv.Count - 1)] } else { [string[]]@() }
            return (PrgAnalyzeTool $tool $rest $ctx $readSqlFile $depth)
        }
    }
    $flagSet = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($a in $argv) { [void]$flagSet.Add((PrgLower $a.Trim())) }
    $ogrEvidence = $false
    foreach ($f in $spec.OgrLayerNameFlags) { if ($flagSet.Contains($f)) { $ogrEvidence = $true } }
    foreach ($f in $spec.OgrSqlFlags) { if ($flagSet.Contains($f)) { $ogrEvidence = $true } }
    foreach ($a in $argv) { if (PrgIsPgDatasource $a) { $ogrEvidence = $true } }
    if ($ogrEvidence) {
        $rest = if ($argv.Count -gt 1) { [string[]]$argv[1..($argv.Count - 1)] } else { [string[]]@() }
        return (PrgAnalyzeOgr2ogr $rest)[0]
    }
    foreach ($a in $argv) {
        if ($a -match '\s') {
            $lower = PrgLower $a
            $mentions = $false
            foreach ($name in $spec.Tools.Keys) { if ($lower.Contains($name)) { $mentions = $true } }
            if ($mentions) { $acc.Merge((PrgAnalyzeCommandAt $a $readSqlFile ($depth + 1))) }
        }
    }
    return $acc
}

function PrgAnalyzeCommandAt([string]$command, $readSqlFile, [int]$depth) {
    $acc = [PrgAcc]::new()
    foreach ($pipeline in (Split-ProtectedCommandLine $command)) {
        $tools = [System.Collections.Generic.List[object]]::new()
        foreach ($seg in $pipeline) {
            $found = $null
            foreach ($a in $seg.argv) { $found = PrgToolOf $a; if ($null -ne $found) { break } }
            $tools.Add($found)
        }
        for ($n = 0; $n -lt $pipeline.Count; $n++) {
            $seg = $pipeline[$n]
            $ctx = [pscustomobject]@{ stdin = $seg.stdin; stdinFile = $seg.stdinFile; pipedFrom = $(if ($n -gt 0) { $tools[$n - 1] } else { $null }); pipesTo = $(if ($n + 1 -lt $tools.Count) { $tools[$n + 1] } else { $null }) }
            $acc.Merge((PrgAnalyzeArgvAt ([string[]]$seg.argv) $ctx $readSqlFile $depth))
        }
    }
    return $acc
}

function PrgAnalyzeArgv([string[]]$argv, $readSqlFile) {
    return (PrgAnalyzeArgvAt $argv ([pscustomobject]@{ stdin = $null; stdinFile = $null; pipedFrom = $null; pipesTo = $null }) $readSqlFile 0)
}

# ---------------------------------------------------------------------------------------------------------------
# Judgement
# ---------------------------------------------------------------------------------------------------------------

function PrgTargetText([PrgTarget]$t) {
    if ($t.Scope -ceq 'SCHEMA') { return 'schema:' + (PrgCanonicalText ([PrgName]::new($null, $t.Name.Table))) }
    return (PrgCanonicalText $t.Name)
}

function PrgJudge([PrgAcc]$acc, $Definition) {
    $d = if ($Definition) { $Definition } else { Get-ProtectedRelationDefinition }
    $protected = [System.Collections.Generic.List[string[]]]::new()
    $open = [System.Collections.Generic.List[string[]]]::new()
    foreach ($u in $acc.Unresolved) { $open.Add($u) }
    foreach ($t in $acc.Targets) {
        $c = if ($t.Scope -ceq 'SCHEMA') { Get-ProtectedSchemaClassification (PrgCanonicalText ([PrgName]::new($null, $t.Name.Table))) $d } else { Get-ProtectedRelationClassification $t.Name $d }
        if ($c.kind -ceq 'PROTECTED') { $protected.Add([string[]]@($t.Op, (PrgTargetText $t), $c.class)) }
        elseif ($c.kind -ceq 'UNRESOLVABLE') { $open.Add([string[]]@($t.Op, 'not a relation name')) }
    }
    $verdict = if ($protected.Count -gt 0) { 'PROTECTED' } elseif ($open.Count -gt 0) { 'UNRESOLVABLE' } else { 'ALLOWED' }
    return [pscustomobject]@{ verdict = $verdict; protected = $protected; unresolved = $open }
}

function PrgOrdinalSortedUnique($items) {
    $set = [System.Collections.Generic.SortedSet[string]]::new([StringComparer]::Ordinal)
    foreach ($x in $items) { [void]$set.Add($x) }
    return , ([string[]]@($set))
}

function PrgNormalized($judged) {
    $p = PrgOrdinalSortedUnique @($judged.protected | ForEach-Object { "$($_[0]) $($_[1])" })
    $u = PrgOrdinalSortedUnique @($judged.unresolved | ForEach-Object { $_[0] })
    return [ordered]@{ verdict = $judged.verdict; protected = $p; unresolved = $u }
}

function Get-ProtectedWriteClassification($Case, $Definition) {
    $d = if ($Definition) { $Definition } else { Get-ProtectedRelationDefinition }
    switch -CaseSensitive ($Case.kind) {
        'sql' { return PrgNormalized (PrgJudge (PrgAnalyzeSql $Case.text) $d) }
        'ogr2ogr' { return PrgNormalized (PrgJudge (PrgAnalyzeOgr2ogr ([string[]]@($Case.args)))[0] $d) }
        'argv' { return PrgNormalized (PrgJudge (PrgAnalyzeArgv ([string[]]@($Case.args)) $null) $d) }
        'command' { return PrgNormalized (PrgJudge (PrgAnalyzeCommandAt $Case.text $null 0) $d) }
    }
    $schemaLevel = $Case.kind -ceq 'schema' -or ($Case.kind -ceq 'operation' -and (Test-ProtectedSchemaOperation $Case.operation))
    $c = if ($schemaLevel) { Get-ProtectedSchemaClassification $Case.text $d } else { Get-ProtectedRelationClassification $Case.text $d }
    $op = if ($Case.kind -ceq 'operation') { $Case.operation } else { $Case.kind.ToUpperInvariant() }
    if ($c.kind -ceq 'PROTECTED') { return [ordered]@{ verdict = 'PROTECTED'; protected = [string[]]@("$op $($c.relation)"); unresolved = [string[]]@() } }
    if ($c.kind -ceq 'UNRESOLVABLE') { return [ordered]@{ verdict = 'UNRESOLVABLE'; protected = [string[]]@(); unresolved = [string[]]@($op) } }
    return [ordered]@{ verdict = 'ALLOWED'; protected = [string[]]@(); unresolved = [string[]]@() }
}

# The parity harness: every case of a corpus file, as JSON (ASCII-escaped).
function Invoke-ProtectedWriteCorpus([string]$Path) {
    $cases = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    $d = Get-ProtectedRelationDefinition
    $out = foreach ($case in $cases) {
        try { $r = Get-ProtectedWriteClassification $case $d; [ordered]@{ id = $case.id; verdict = $r.verdict; protected = $r.protected; unresolved = $r.unresolved } }
        catch { [ordered]@{ id = $case.id; verdict = 'ERROR'; protected = @(); unresolved = @(); error = $_.Exception.Message } }
    }
    return (ConvertTo-Json -InputObject @($out) -Depth 5 -Compress -EscapeHandling EscapeNonAscii)
}

# ---------------------------------------------------------------------------------------------------------------
# The gate
# ---------------------------------------------------------------------------------------------------------------

function PrgRefuse([string]$Caller, $judged, [string]$what) {
    if ($judged.protected.Count -gt 0) {
        $p = $judged.protected[0]
        throw "REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION: $Caller may not $($p[0]) $($p[1]): $($p[2]); only the governed import path may change it. There is no override."
    }
    if ($judged.unresolved.Count -gt 0) {
        $u = $judged.unresolved[0]
        throw "REJECT_DESTRUCTIVE_WRITE_TARGET_UNRESOLVABLE: $Caller may not $($u[0]) (unresolved): $($u[1]); ${what}: a target that is not static cannot be shown not to be protected"
    }
}

function PrgReadSqlFileForGate([string]$path) { if (Test-Path -LiteralPath $path -PathType Leaf) { return (Get-Content -LiteralPath $path -Raw -Encoding UTF8) }; return $null }

function Assert-UngovernedWriteAllowed {
    param(
        [Parameter(Mandatory = $true)][string]$Caller,
        [Parameter(Mandatory = $true)][string]$Operation,
        [Parameter(Mandatory = $true)][string]$Relation
    )
    try {
        $d = Get-ProtectedRelationDefinition
        $c = if (Test-ProtectedSchemaOperation $Operation) { Get-ProtectedSchemaClassification $Relation $d } else { Get-ProtectedRelationClassification $Relation $d }
    } catch {
        throw "REJECT_DESTRUCTIVE_WRITE_TARGET_UNRESOLVABLE: $Caller may not $Operation ${Relation}: the protected relation definition could not be read: $($_.Exception.Message)"
    }
    if ($c.kind -ceq 'UNPROTECTED') { return }
    if ($c.kind -ceq 'UNRESOLVABLE') {
        throw "REJECT_DESTRUCTIVE_WRITE_TARGET_UNRESOLVABLE: $Caller may not $Operation ${Relation}: not a relation name"
    }
    throw "REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION: $Caller may not $Operation $($c.relation): $($c.class); only the governed import path may change it. There is no override."
}

function Get-GatedSql {
    param([Parameter(Mandatory = $true)][string]$Caller, [Parameter(Mandatory = $true)][string]$Sql)
    PrgRefuse $Caller (PrgJudge (PrgAnalyzeSql $Sql) $null) "SQL $($Sql.Substring(0, [Math]::Min(160, $Sql.Length)))"
    return $Sql
}

function Assert-Ogr2ogrWriteAllowed {
    param([Parameter(Mandatory = $true)][string]$Caller, [Parameter(Mandatory = $true)][string[]]$Arguments)
    PrgRefuse $Caller (PrgJudge (PrgAnalyzeOgr2ogr $Arguments)[0] $null) 'ogr2ogr'
    return , $Arguments
}

function Assert-CommandWriteAllowed {
    param([Parameter(Mandatory = $true)][string]$Caller, [string]$Command, [string[]]$Argv)
    $reader = { param($p) PrgReadSqlFileForGate $p }
    $acc = if ($null -ne $Argv) { PrgAnalyzeArgv $Argv $reader } else { PrgAnalyzeCommandAt $Command $reader 0 }
    PrgRefuse $Caller (PrgJudge $acc $null) 'command'
    if ($null -ne $Argv) { return , $Argv }
    return $Command
}
