"""
protected_relation_gate.py -- U30F F1 / U30F2 M1-M2 (PRES-05): the Python binding of the protected
relation gate.

It reads the SAME two files the TypeScript gate reads:
  packages/spatial-provider-postgis/src/protected-relations.v1.json          (which relations are protected)
  packages/spatial-provider-postgis/src/protected-relation-classification.v1.json (how names, SQL,
      ogr2ogr arguments and command lines are read)
and implements the same algorithm as ProtectedRelations.ts + ProtectedWriteClassifier.ts.
tests/unit/protectedRelationGateBindings.test.ts holds it to identical verdicts over one corpus (every
verifier canary) plus generated variations (`--corpus`).

A Python importer goes through the gate at the call that writes:
    run_sql(gated_sql(GATE_CALLER, sql))
    subprocess.run(assert_ogr2ogr_write_allowed(GATE_CALLER, cmd))
    subprocess.run(assert_command_write_allowed(GATE_CALLER, argv=cmd))
or, for a single named relation, `assert_ungoverned_write_allowed(caller, operation, relation)`
(a schema operation such as DROP_SCHEMA classifies the schema). A protected or unresolvable target
raises ProtectedRelationGateError; there is no override, no environment switch and no force flag. A
missing or malformed definition refuses every call (fail-closed).

This module has no side effects on import and never touches a database.
"""
import json
import os
import pathlib
import re
import sys

PROTECTED_RELATIONS_CONTRACT_V1 = 'mimer-protected-relations-v1'
CLASSIFICATION_CONTRACT_V1 = 'mimer-protected-relation-classification-v1'
_SRC = pathlib.Path(__file__).resolve().parents[2] / 'packages' / 'spatial-provider-postgis' / 'src'
PROTECTED_RELATIONS_FILE = _SRC / 'protected-relations.v1.json'
CLASSIFICATION_FILE = _SRC / 'protected-relation-classification.v1.json'
REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION = 'REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION'
REJECT_DESTRUCTIVE_WRITE_TARGET_UNRESOLVABLE = 'REJECT_DESTRUCTIVE_WRITE_TARGET_UNRESOLVABLE'
_PLAIN = re.compile(r'[a-z_][a-z0-9_]*')
_NAME_PART = re.compile(r'\s*(?:"((?:[^"]|"")+)"|([A-Za-z_][A-Za-z0-9_$]*))\s*')


class ProtectedRelationGateError(RuntimeError):
    def __init__(self, code, caller, operation, relation, detail):
        super().__init__(f'{code}: {caller} may not {operation} {relation}: {detail}')
        self.code = code
        self.caller = caller
        self.operation = operation
        self.relation = relation


# ------------------------------------------------------------------------------------------------
# Definition and specification
# ------------------------------------------------------------------------------------------------

def load_definition(path=PROTECTED_RELATIONS_FILE):
    """The validated definition; any defect raises (and so refuses every write)."""
    data = json.loads(pathlib.Path(path).read_text(encoding='utf-8'))
    if data.get('contract') != PROTECTED_RELATIONS_CONTRACT_V1:
        raise RuntimeError('PROTECTED_RELATIONS_DEFINITION_INVALID: contract')
    schemas = data.get('retained_staging_schemas')
    relations = data.get('relations')
    if not schemas or not all(isinstance(s, str) and _PLAIN.fullmatch(s) for s in schemas):
        raise RuntimeError('PROTECTED_RELATIONS_DEFINITION_INVALID: retained_staging_schemas')
    if not relations:
        raise RuntimeError('PROTECTED_RELATIONS_DEFINITION_INVALID: relations')
    entries = []
    for r in relations:
        parts = str(r.get('relation', '')).split('.')
        if len(parts) != 2 or not all(_PLAIN.fullmatch(p) for p in parts) or r.get('class') not in ('LU_LIVE_LAYER', 'LU_DERIVED'):
            raise RuntimeError(f'PROTECTED_RELATIONS_DEFINITION_INVALID: {r!r}')
        entries.append({'relation': r['relation'], 'schema': parts[0], 'table': parts[1], 'class': r['class']})
    return {'retained_staging_schemas': list(schemas), 'relations': entries}


_SPEC_CACHE = {}


def load_spec(path=CLASSIFICATION_FILE):
    """The validated classification specification (cached per path); any defect raises."""
    key = str(path)
    if key in _SPEC_CACHE:
        return _SPEC_CACHE[key]
    doc = json.loads(pathlib.Path(path).read_text(encoding='utf-8'))
    if doc.get('contract') != CLASSIFICATION_CONTRACT_V1:
        raise RuntimeError('PROTECTED_RELATION_CLASSIFICATION_INVALID: contract')
    naming = doc.get('relation_naming') or {}
    lengths = [naming.get('current', {}).get('digest_hex_length')] + [l.get('digest_hex_length') for l in naming.get('legacy', [])]
    if not all(isinstance(n, int) and 8 <= n <= 64 for n in lengths) or len(set(lengths)) != len(lengths):
        raise RuntimeError('PROTECTED_RELATION_CLASSIFICATION_INVALID: relation_naming')
    if naming.get('max_identifier_bytes') != 63:
        raise RuntimeError('PROTECTED_RELATION_CLASSIFICATION_INVALID: max_identifier_bytes')
    for key2 in ('sql', 'ogr2ogr', 'commands', 'schema_operations', 'partition_suffix_pattern'):
        if key2 not in doc:
            raise RuntimeError(f'PROTECTED_RELATION_CLASSIFICATION_INVALID: {key2}')
    # U30F5: the D-3/D-4/D-5/B8 vocabularies are required -- a missing list would read as "nothing to refuse"
    for key2 in ('privilege_other_object_kinds', 'role_options_unresolvable'):
        v = doc['sql'].get(key2)
        if not isinstance(v, list) or not v or not all(isinstance(x, str) and x for x in v):
            raise RuntimeError(f'PROTECTED_RELATION_CLASSIFICATION_INVALID: sql.{key2}')
    remote = doc['sql'].get('foreign_table_remote_options')
    if not isinstance(remote, dict) or not isinstance(remote.get('schema'), str) or not isinstance(remote.get('table'), str):
        raise RuntimeError('PROTECTED_RELATION_CLASSIFICATION_INVALID: sql.foreign_table_remote_options')
    pgbench = doc['commands'].get('pgbench') or {}
    if not isinstance(pgbench.get('file_flags'), list) or not pgbench['file_flags']:
        raise RuntimeError('PROTECTED_RELATION_CLASSIFICATION_INVALID: commands.pgbench.file_flags')
    # U30F8: the G6-1/G6-7 vocabularies are required -- a missing table would read as "nothing to refuse"
    code_runners = doc['commands'].get('code_runners')
    if not isinstance(code_runners, dict) or not code_runners or not all(isinstance(v, list) and v and all(isinstance(x, str) and x for x in v) for v in code_runners.values()):
        raise RuntimeError('PROTECTED_RELATION_CLASSIFICATION_INVALID: commands.code_runners')
    for key3 in ('eval_words', 'program_prefix_words'):
        v3 = doc['commands'].get(key3)
        if not isinstance(v3, list) or not v3 or not all(isinstance(x, str) and x for x in v3):
            raise RuntimeError(f'PROTECTED_RELATION_CLASSIFICATION_INVALID: commands.{key3}')
    runners = doc['commands'].get('argument_substituting_runners')
    if not isinstance(runners, list) or not runners or not all(isinstance(x, str) and x for x in runners):
        raise RuntimeError('PROTECTED_RELATION_CLASSIFICATION_INVALID: commands.argument_substituting_runners')
    # U30F9: the G8-5/G8-12/default-deny vocabularies are required -- a missing table would read as "nothing to refuse"
    remote_shells = doc['commands'].get('remote_shells')
    if not isinstance(remote_shells, dict) or not remote_shells or not all(
            isinstance(v, dict) and isinstance(v.get('value_flags'), list) and v['value_flags'] and all(isinstance(x, str) and x for x in v['value_flags'])
            for v in remote_shells.values()):
        raise RuntimeError('PROTECTED_RELATION_CLASSIFICATION_INVALID: commands.remote_shells')
    for key4, where in (('unread_code_runners', doc['commands']), ('read_only_flags', doc['commands'].get('ogrinfo') or {}), ('database_subcommands', doc['commands'].get('prisma') or {})):
        v4 = where.get(key4)
        if not isinstance(v4, list) or not v4 or not all(isinstance(x, str) and x for x in v4):
            raise RuntimeError(f'PROTECTED_RELATION_CLASSIFICATION_INVALID: commands.{key4}')
    exempt = doc['commands'].get('non_literal_exempt_tools_unless_piped_to')
    if not isinstance(exempt, dict) or not all(isinstance(v, str) and v for v in exempt.values()):
        raise RuntimeError('PROTECTED_RELATION_CLASSIFICATION_INVALID: commands.non_literal_exempt_tools_unless_piped_to')
    # U30G814 (G8-14): the connection vocabulary is required -- a missing list would read as "no connection is ever chosen"
    for key5 in ('connection_env_variables', 'env_assignment_words'):
        v5 = doc['commands'].get(key5)
        if not isinstance(v5, list) or not v5 or not all(isinstance(x, str) and x for x in v5):
            raise RuntimeError(f'PROTECTED_RELATION_CLASSIFICATION_INVALID: commands.{key5}')
    doc['_lengths'] = lengths
    _SPEC_CACHE[key] = doc
    return doc


def _dyn(spec, hint=''):
    clean = re.sub(r'[^A-Za-z0-9_.-]', '', hint or '')
    return spec['dynamic_placeholder_open'] + (':' + clean if clean else '') + spec['dynamic_placeholder_close']


def _contains_dynamic(spec, text):
    return spec['dynamic_placeholder_open'] in text


def _dynamic_hint(spec, text):
    o, c = spec['dynamic_placeholder_open'], spec['dynamic_placeholder_close']
    t = text.strip()
    if not t.startswith(o) or not t.endswith(c):
        return None
    inner = t[len(o):len(t) - len(c)]
    if o in inner:
        return None
    return inner[1:] if inner.startswith(':') else ''


# ------------------------------------------------------------------------------------------------
# Names and classification (ProtectedRelations.ts)
# ------------------------------------------------------------------------------------------------

def parse_relation_name(raw):
    """(schema or None, table) the way PostgreSQL resolves the name, or None."""
    text = re.sub(r'\s*\*$', '', re.sub(r'^ONLY\s+', '', str(raw).strip(), flags=re.IGNORECASE))
    parts = []
    pos = 0
    while True:
        m = _NAME_PART.match(text, pos)
        if not m:
            return None
        parts.append(m.group(1).replace('""', '"') if m.group(1) is not None else m.group(2).lower())
        pos = m.end()
        if pos == len(text):
            break
        if text[pos] != '.':
            return None
        pos += 1
    if len(parts) == 1:
        return (None, parts[0])
    if len(parts) in (2, 3):
        return (parts[-2], parts[-1])
    return None


def format_relation_name(name):
    schema, table = name
    return table if schema is None else f'{schema}.{table}'


def _canonical_part(part):
    return part if re.fullmatch(r'[a-z_][a-z0-9_$]*', part) else '"' + part.replace('"', '""') + '"'


def canonical_relation_text(name):
    schema, table = name
    return _canonical_part(table) if schema is None else f'{_canonical_part(schema)}.{_canonical_part(table)}'


def _is_retained_suffix(suffix, spec):
    return re.fullmatch(r'[0-9a-f]+', suffix) is not None and len(suffix) in spec['_lengths']


def has_retained_relation_shape(table, spec=None):
    spec = spec or load_spec()
    m = re.fullmatch(r'([a-z_][a-z0-9_]*)_([0-9a-f]+)', table)
    return m is not None and _is_retained_suffix(m.group(2), spec)


def _partition_of(entry, table, spec):
    prefix = entry['table'] + '_'
    return table.startswith(prefix) and re.fullmatch(spec['partition_suffix_pattern'], table[len(prefix):]) is not None


def _retained_shape_of(entry, table, spec):
    prefix = entry['table'] + '_'
    return table.startswith(prefix) and _is_retained_suffix(table[len(prefix):], spec)


def classify_relation(raw, definition=None, spec=None):
    """{'kind': PROTECTED|UNPROTECTED|UNRESOLVABLE, 'relation': ..., 'class': ...}"""
    d = definition or load_definition()
    spec = spec or load_spec()
    parsed = raw if isinstance(raw, tuple) else parse_relation_name(raw)
    if parsed is None:
        return {'kind': 'UNRESOLVABLE', 'relation': str(raw).strip()}
    schema, table = parsed
    relation = format_relation_name(parsed)
    if schema is not None:
        if schema in d['retained_staging_schemas']:
            return {'kind': 'PROTECTED', 'relation': relation, 'class': 'RETAINED_STAGING'}
        for e in d['relations']:
            if e['schema'] == schema and (e['table'] == table or _partition_of(e, table, spec)):
                return {'kind': 'PROTECTED', 'relation': relation, 'class': e['class']}
        return {'kind': 'UNPROTECTED', 'relation': relation}
    for e in d['relations']:
        if e['table'] == table or _partition_of(e, table, spec):
            return {'kind': 'PROTECTED', 'relation': relation, 'class': e['class']}
        if _retained_shape_of(e, table, spec):
            return {'kind': 'PROTECTED', 'relation': relation, 'class': 'RETAINED_STAGING'}
    if spec['unqualified_names']['retained_shape_any_prefix'] and has_retained_relation_shape(table, spec):
        return {'kind': 'PROTECTED', 'relation': relation, 'class': 'RETAINED_STAGING'}
    return {'kind': 'UNPROTECTED', 'relation': relation}


def classify_schema(raw, definition=None):
    """A schema is protected when it is a retained-staging schema or holds a protected relation."""
    d = definition or load_definition()
    parsed = parse_relation_name(raw)
    if parsed is None or parsed[0] is not None:
        return {'kind': 'UNRESOLVABLE', 'relation': str(raw)}
    name = parsed[1]
    if name in d['retained_staging_schemas']:
        return {'kind': 'PROTECTED', 'relation': f'{name}.*', 'class': 'RETAINED_STAGING'}
    for e in d['relations']:
        if e['schema'] == name:
            return {'kind': 'PROTECTED', 'relation': f'{name}.*', 'class': e['class']}
    return {'kind': 'UNPROTECTED', 'relation': f'{name}.*'}


def is_schema_operation(operation, spec=None):
    return operation in (spec or load_spec())['schema_operations']


# ------------------------------------------------------------------------------------------------
# SQL tokenizer (ProtectedWriteClassifier.ts tokenizeSql)
# ------------------------------------------------------------------------------------------------

_WS = ' \t\n\r\f\v'


def _is_ws(c):
    return len(c) == 1 and c in _WS


def _is_letter(c):
    return ('A' <= c <= 'Z') or ('a' <= c <= 'z')


def _is_digit(c):
    return '0' <= c <= '9'


def _is_high(c):
    return len(c) > 0 and ord(c[0]) >= 0x80


def _ascii_lower(s):
    return ''.join(chr(ord(c) + 32) if 'A' <= c <= 'Z' else c for c in s)


def _at(s, i):
    return s[i] if 0 <= i < len(s) else ''


def _read_quoted(s, i, quote, backslash):
    j = i + 1
    value = []
    while j < len(s):
        c = s[j]
        if backslash and c == '\\':
            if j + 1 >= len(s):
                return None
            value.append(s[j + 1])
            j += 2
            continue
        if c == quote:
            if _at(s, j + 1) == quote:
                value.append(quote)
                j += 2
                continue
            return (''.join(value), j + 1)
        value.append(c)
        j += 1
    return None


def _is_hex(s):
    return len(s) > 0 and all(_is_digit(c) or 'a' <= c <= 'f' or 'A' <= c <= 'F' for c in s)


def _decode_unicode_escapes(v):
    out = []
    j = 0
    while j < len(v):
        c = v[j]
        if c != '\\':
            out.append(c)
            j += 1
            continue
        if _at(v, j + 1) == '\\':
            out.append('\\')
            j += 2
            continue
        if _at(v, j + 1) == '+' and len(v[j + 2:j + 8]) == 6 and _is_hex(v[j + 2:j + 8]):
            cp = int(v[j + 2:j + 8], 16)
            if cp > 0x10FFFF or 0xD800 <= cp <= 0xDFFF:
                return None
            out.append(chr(cp))
            j += 8
            continue
        if len(v[j + 1:j + 5]) == 4 and _is_hex(v[j + 1:j + 5]):
            cp = int(v[j + 1:j + 5], 16)
            if 0xD800 <= cp <= 0xDFFF:
                return None
            out.append(chr(cp))
            j += 5
            continue
        return None
    return ''.join(out)


def _followed_by_uescape(s, i):
    j = i
    while j < len(s) and _is_ws(s[j]):
        j += 1
    nxt = _at(s, j + 7)
    return _ascii_lower(s[j:j + 7]) == 'uescape' and not (_is_letter(nxt) or _is_digit(nxt) or nxt == '_')


def tokenize_sql(s, spec=None):
    """[(type, value, adj, bad)], error-or-None"""
    spec = spec or load_spec()
    o, c_ = spec['dynamic_placeholder_open'], spec['dynamic_placeholder_close']
    toks = []
    state = {'last_end': -1}
    copy_line = [False]

    def push(t, v, start, end, bad=False):
        toks.append((t, v, start == state['last_end'], bad))
        state['last_end'] = end

    def ident_start(k):
        ch = _at(s, k)
        return (_is_letter(ch) or ch == '_' or _is_high(ch)) and not s.startswith(o, k) and not s.startswith(c_, k)

    def ident_char(k):
        ch = _at(s, k)
        return (_is_letter(ch) or _is_digit(ch) or ch == '_' or ch == '$' or _is_high(ch)) and not s.startswith(o, k) and not s.startswith(c_, k)

    i = 0
    n = len(s)
    while i < n:
        c = s[i]
        if _is_ws(c):
            if c == '\n' and copy_line[0]:
                push('SEMI', ';', i, i + 1)
                copy_line[0] = False
            i += 1
            continue
        if s.startswith(o, i):
            end = s.find(c_, i + len(o))
            if end < 0:
                return toks, 'unterminated dynamic placeholder'
            inner = s[i + len(o):end]
            push('DYN', inner[1:] if inner.startswith(':') else '', i, end + len(c_))
            i = end + len(c_)
            continue
        if c == '-' and _at(s, i + 1) == '-':
            nl = s.find('\n', i)
            i = n if nl < 0 else nl
            continue
        if c == '/' and _at(s, i + 1) == '*':
            depth = 1
            j = i + 2
            while j < n and depth > 0:
                if s[j] == '/' and _at(s, j + 1) == '*':
                    depth += 1
                    j += 2
                elif s[j] == '*' and _at(s, j + 1) == '/':
                    depth -= 1
                    j += 2
                else:
                    j += 1
            if depth > 0:
                return toks, 'unterminated block comment'
            i = j
            continue
        if c in 'uU' and _at(s, i + 1) == '&' and _at(s, i + 2) in ("'", '"') and _at(s, i + 2) != '':
            q = s[i + 2]
            r = _read_quoted(s, i + 2, q, False)
            if r is None:
                return toks, 'unterminated string' if q == "'" else 'unterminated quoted identifier'
            decoded = _decode_unicode_escapes(r[0])
            if q == "'":
                push('STRING', decoded if decoded is not None else r[0], i, r[1])
            else:
                push('QIDENT', decoded if decoded is not None else r[0], i, r[1],
                     decoded is None or _followed_by_uescape(s, r[1]) or len(r[0]) == 0
                     or o in (decoded if decoded is not None else r[0]))
            i = r[1]
            continue
        if c in 'eE' and _at(s, i + 1) == "'":
            r = _read_quoted(s, i + 1, "'", True)
            if r is None:
                return toks, 'unterminated string'
            push('STRING', r[0], i, r[1])
            i = r[1]
            continue
        if c in 'bBxXnN' and _at(s, i + 1) == "'":
            r = _read_quoted(s, i + 1, "'", False)
            if r is None:
                return toks, 'unterminated string'
            push('STRING', r[0], i, r[1])
            i = r[1]
            continue
        if c == "'":
            r = _read_quoted(s, i, "'", False)
            if r is None:
                return toks, 'unterminated string'
            push('STRING', r[0], i, r[1])
            i = r[1]
            continue
        if c == '"':
            r = _read_quoted(s, i, '"', False)
            if r is None:
                return toks, 'unterminated quoted identifier'
            # U30F2 H1: "${schema}" in a shell command line is a name the text does not hold
            push('QIDENT', r[0], i, r[1], len(r[0]) == 0 or o in r[0])
            i = r[1]
            continue
        if c == '$':
            if _is_digit(_at(s, i + 1)):
                j = i + 1
                while j < n and _is_digit(s[j]):
                    j += 1
                push('PARAM', s[i:j], i, j)
                i = j
                continue
            j = i + 1
            if ident_start(j):
                j += 1
                while j < n and ident_char(j) and s[j] != '$':
                    j += 1
            if _at(s, j) == '$':
                tag = s[i:j + 1]
                end = s.find(tag, j + 1)
                if end < 0:
                    return toks, 'unterminated dollar-quoted string'
                # `bad` on a STRING marks a dollar-quoted body (DO / function code), U30F2 H1
                push('STRING', s[j + 1:end], i, end + len(tag), True)
                i = end + len(tag)
                continue
            push('OP', '$', i, i + 1)
            i += 1
            continue
        if c == ':' and _at(s, i + 1) != ':' and _at(s, i - 1) != ':' and (ident_start(i + 1) or _at(s, i + 1) in ("'", '"') and _at(s, i + 1) != ''):
            j = i + 1
            if s[j] in ("'", '"'):
                r = _read_quoted(s, j, s[j], False)
                if r is None:
                    return toks, 'unterminated psql variable'
                hint = r[0]
                j = r[1]
            else:
                start = j
                while j < n and ident_char(j):
                    j += 1
                hint = s[start:j]
            push('DYN', hint, i, j)
            i = j
            continue
        if ident_start(i):
            j = i + 1
            while j < n and ident_char(j):
                j += 1
            push('WORD', _ascii_lower(s[i:j]), i, j)
            i = j
            continue
        if _is_digit(c):
            j = i + 1
            while j < n and (_is_digit(s[j]) or _is_letter(s[j]) or s[j] == '_' or (s[j] == '.' and _is_digit(_at(s, j + 1)))):
                j += 1
            push('NUMBER', s[i:j], i, j)
            i = j
            continue
        if c == '\\':
            j = i + 1
            if _at(s, j) == '!':
                j += 1
            else:
                while j < n and _is_letter(s[j]):
                    j += 1
            name = _ascii_lower(s[i + 1:j])
            if len(name) == 0:
                push('OP', '\\', i, i + 1)
                i += 1
                continue
            if name in spec['sql']['psql_meta_copy']:
                push('WORD', 'copy', i, j)
                copy_line[0] = True
                i = j
                continue
            if name in spec['sql']['psql_meta_unresolvable']:
                push('META', name, i, j)
            nl = s.find('\n', j)
            i = n if nl < 0 else nl
            continue
        if c == ';':
            push('SEMI', ';', i, i + 1)
        elif c == '(':
            push('LPAREN', '(', i, i + 1)
        elif c == ')':
            push('RPAREN', ')', i, i + 1)
        elif c == ',':
            push('COMMA', ',', i, i + 1)
        elif c == '.':
            push('DOT', '.', i, i + 1)
        elif c == '|' and _at(s, i + 1) == '|':
            push('OP', '||', i, i + 2)
            i += 2
            continue
        elif c == ':' and _at(s, i + 1) == ':':
            push('OP', '::', i, i + 2)
            i += 2
            continue
        else:
            push('OP', c, i, i + 1)
        i += 1
    return toks, None


# ------------------------------------------------------------------------------------------------
# SQL analysis (ProtectedWriteClassifier.ts SqlAnalyzer)
# ------------------------------------------------------------------------------------------------

def _t(tok):
    return tok[0]


def _v(tok):
    return tok[1]


def _get(toks, k):
    return toks[k] if 0 <= k < len(toks) else None


def _contains_trigger_word(text, spec):
    lower = _ascii_lower(text)

    def boundary(ch):
        return ch == '' or not (_is_letter(ch) or _is_digit(ch) or ch == '_')

    for w in spec['sql']['trigger_words']:
        frm = 0
        while True:
            at = lower.find(w, frm)
            if at < 0:
                break
            before = '' if at == 0 else lower[at - 1]
            after = _at(lower, at + len(w))
            if boundary(before) and boundary(after):
                return True
            frm = at + 1
    return False


def _match_paren(toks, i):
    depth = 0
    for j in range(i, len(toks)):
        if _t(toks[j]) == 'LPAREN':
            depth += 1
        elif _t(toks[j]) == 'RPAREN':
            depth -= 1
            if depth == 0:
                return j
    return len(toks) - 1


def _piece_end(toks, i):
    t = _get(toks, i)
    if t is None:
        return i
    if _t(t) == 'LPAREN':
        j = _match_paren(toks, i) + 1
    elif _t(t) in ('WORD', 'QIDENT'):
        j = i + 1
        while _get(toks, j) is not None and _t(toks[j]) == 'DOT' and _get(toks, j + 1) is not None and _t(toks[j + 1]) in ('WORD', 'QIDENT'):
            j += 2
        if _get(toks, j) is not None and _t(toks[j]) == 'LPAREN':
            j = _match_paren(toks, j) + 1
    else:
        j = i + 1
    while _get(toks, j) is not None and _t(toks[j]) == 'OP' and _v(toks[j]) == '::' and _get(toks, j + 1) is not None and _t(toks[j + 1]) == 'WORD':
        j += 2
    return j


def _embedded_texts(toks, dyn, spec):
    texts = []
    consumed = set()
    piece_starts = set()
    for i in range(len(toks)):
        if i in piece_starts:
            continue
        t = toks[i]
        if _t(t) in ('OP', 'SEMI', 'COMMA', 'RPAREN', 'DOT'):
            continue
        pieces = [(i, _piece_end(toks, i))]
        j = pieces[0][1]
        while _get(toks, j) is not None and _t(toks[j]) == 'OP' and _v(toks[j]) == '||' and j + 1 < len(toks):
            e = _piece_end(toks, j + 1)
            pieces.append((j + 1, e))
            j = e

        def is_string(p):
            return _t(toks[p[0]]) == 'STRING' and p[1] - p[0] == 1

        if len(pieces) > 1 and any(is_string(p) for p in pieces):
            texts.append(''.join(_v(toks[p[0]]) if is_string(p) else dyn for p in pieces))
            for p in pieces:
                piece_starts.add(p[0])
                if is_string(p):
                    consumed.add(p[0])
    code = []
    for k, t in enumerate(toks):
        if (_t(t) == 'STRING' and k not in consumed) or _t(t) == 'QIDENT':
            texts.append(_v(t))
        # U30F2 H1: a dollar-quoted body holding a dynamic value (`DO $$BEGIN $CMD; END$$`) is code the text does not hold
        if _t(t) == 'STRING' and t[3] and k not in consumed and not _contains_trigger_word(_v(t), spec) and _contains_dynamic(spec, _v(t)):
            code.append(_v(t))
    return [x for x in texts if _contains_trigger_word(x, spec)] + code


def _split_statements(toks):
    out = []
    cur = []
    for t in toks:
        if _t(t) == 'SEMI':
            if cur:
                out.append(cur)
            cur = []
        else:
            cur.append(t)
    if cur:
        out.append(cur)
    return out


def _parse_name_at(toks, j, spec, only=False, star=False):
    reserved = spec['sql']['reserved_at_name_position']
    k = j
    if only and _get(toks, k) is not None and _t(toks[k]) == 'WORD' and _v(toks[k]) == 'only':
        k += 1
    parts = []
    while True:
        t = _get(toks, k)
        if t is None:
            return None, k
        if _t(t) == 'WORD' and _v(t) not in reserved:
            parts.append(_v(t))
        elif _t(t) == 'QIDENT' and not t[3]:
            parts.append(_v(t))
        else:
            return None, k
        k += 1
        nx = _get(toks, k)
        if nx is not None and nx[2] and _t(nx) in ('WORD', 'NUMBER', 'DYN', 'PARAM', 'QIDENT', 'STRING'):
            return None, k
        if _get(toks, k) is not None and _t(toks[k]) == 'DOT':
            if len(parts) >= 3:
                return None, k
            k += 1
            continue
        break
    if star and _get(toks, k) is not None and _t(toks[k]) == 'OP' and _v(toks[k]) == '*':
        k += 1
    name = (None, parts[0]) if len(parts) == 1 else (parts[-2], parts[-1])
    return name, k


def _word_at(toks, k, v):
    t = _get(toks, k)
    return t is not None and _t(t) == 'WORD' and _v(t) == v


def _words_at(toks, k, seq):
    return all(_word_at(toks, k + n, w) for n, w in enumerate(seq))


def _match_kind(toks, k, kinds):
    best = None
    for kind in kinds:
        if _words_at(toks, k, kind) and (best is None or len(kind) > len(best)):
            best = kind
    return best


def _prev_key(toks, p):
    prev = _get(toks, p - 1)
    if prev is None:
        return None
    if _t(prev) == 'WORD':
        return _v(prev)
    return {'COMMA': ',', 'LPAREN': '(', 'RPAREN': ')', 'DYN': 'DYN'}.get(_t(prev), _t(prev))


def _at_statement_start(toks, p, spec):
    if p == 0:
        return True
    key = _prev_key(toks, p)
    return key is not None and key in spec['sql']['statement_start_after']


def _describe_at(toks, p):
    out = []
    for t in toks[p:p + 6]:
        out.append('<dynamic>' if _t(t) == 'DYN' else "'…'" if _t(t) == 'STRING' else _v(t))
    return ' '.join(out)


def _after_defining_as(toks):
    # U30F3 M-1: the index after the first AS outside parentheses (a view's defining query), or the end
    depth = 0
    for k, t in enumerate(toks):
        if _t(t) == 'LPAREN':
            depth += 1
        elif _t(t) == 'RPAREN':
            depth -= 1
        elif depth == 0 and _t(t) == 'WORD' and _v(t) == 'as':
            return k + 1
    return len(toks)


def _split_args(toks):
    args = []
    cur = []
    depth = 0
    for t in toks:
        if _t(t) == 'LPAREN':
            depth += 1
        if _t(t) == 'RPAREN':
            depth -= 1
        if _t(t) == 'COMMA' and depth == 0:
            args.append(cur)
            cur = []
        else:
            cur.append(t)
    if cur or args:
        args.append(cur)
    return args


class _SqlAnalyzer:
    def __init__(self, state, spec):
        self.state = state
        self.spec = spec
        self.targets = []
        self.unresolved = []

    def target(self, op, name, scope='RELATION'):
        self.targets.append((op, scope, name))
        if scope == 'RELATION' and name[0] is None:
            path = self.state['search_path']
            if path == 'UNKNOWN':
                self.unres(op, f'unqualified {name[1]} under a search_path set from a non-constant value')
            elif path:
                for schema in path:
                    self.targets.append((op, scope, (schema, name[1])))

    def unres(self, op, reason):
        self.unresolved.append((op, reason))

    def one(self, toks, p, j, op, only=False, star=False):
        name, end = _parse_name_at(toks, j, self.spec, only, star)
        if name is not None:
            self.target(op, name)
        elif _at_statement_start(toks, p, self.spec):
            self.unres(op, f'target is not a static relation name: {_describe_at(toks, p)}')
        return name, end

    def lst(self, toks, p, j, op, only=False, star=False, schema=False):
        k = j
        while True:
            name, end = _parse_name_at(toks, k, self.spec, only, star)
            if name is None or (schema and name[0] is not None):
                if _at_statement_start(toks, p, self.spec):
                    self.unres(op, f"target is not a static {'schema' if schema else 'relation'} name: {_describe_at(toks, p)}")
                return
            if schema:
                self.target(op, (None, name[1]), 'SCHEMA')
            else:
                self.target(op, name)
            k = end
            if _get(toks, k) is None or _t(toks[k]) != 'COMMA':
                return
            k += 1

    def statement(self, toks):
        sql = self.spec['sql']
        for p, t in enumerate(toks):
            if _t(t) == 'META':
                self.unres('PSQL_META', f'psql \\{_v(t)} runs SQL the text does not contain')
                continue
            # U30F2 H1: `psql -c "$SQL"` / `BEGIN $CMD; END`: the statement's verb is not in the text
            explain_prev = (_prev_key(toks, p) or '') in sql['dynamic_statement_after_explain'] and len(toks) > 0 \
                and _t(toks[0]) == 'WORD' and _v(toks[0]) == 'explain'
            if _t(t) == 'DYN' and (p == 0 or (_prev_key(toks, p) or '') in sql['dynamic_statement_after'] or explain_prev):
                self.unres('DYNAMIC_SQL', 'a statement whose verb is a dynamic value')
                continue
            if _t(t) != 'WORD':
                continue
            prev = _prev_key(toks, p)
            v = _v(t)
            if v == 'truncate':
                if prev is not None and prev in sql['truncate_not_after']:
                    continue
                self.lst(toks, p, p + 2 if _word_at(toks, p + 1, 'table') else p + 1, 'TRUNCATE', only=True, star=True)
            elif v == 'drop':
                self.drop(toks, p)
            elif v == 'delete':
                if _word_at(toks, p + 1, 'from'):
                    self.one(toks, p, p + 2, 'DELETE', only=True, star=True)
            elif v == 'insert':
                if _word_at(toks, p + 1, 'into'):
                    self.one(toks, p, p + 2, 'INSERT')
            elif v == 'merge':
                if _word_at(toks, p + 1, 'into'):
                    self.one(toks, p, p + 2, 'MERGE', only=True)
            elif v == 'update':
                self.update(toks, p, prev)
            elif v == 'copy':
                if _at_statement_start(toks, p, self.spec):
                    self.copy(toks, p)
            elif v == 'alter':
                self.alter(toks, p)
            elif v == 'create':
                self.create(toks, p)
            elif v == 'refresh':
                if _words_at(toks, p + 1, ['materialized', 'view']):
                    self.one(toks, p, p + 4 if _word_at(toks, p + 3, 'concurrently') else p + 3, 'REFRESH')
            elif v == 'reassign':
                if _word_at(toks, p + 1, 'owned') and _at_statement_start(toks, p, self.spec):
                    self.unres('REASSIGN_OWNED', 'REASSIGN OWNED changes every object a role owns')
            elif v == 'import':
                if _words_at(toks, p + 1, ['foreign', 'schema']):
                    into = next((k for k in range(p + 1, len(toks)) if _t(toks[k]) == 'WORD' and _v(toks[k]) == 'into'), -1)
                    name = None if into < 0 else _parse_name_at(toks, into + 1, self.spec)[0]
                    if name is not None and name[0] is None:
                        self.target('IMPORT_FOREIGN_SCHEMA', name, 'SCHEMA')
                    else:
                        self.unres('IMPORT_FOREIGN_SCHEMA', 'IMPORT FOREIGN SCHEMA without a static local schema')
                    self.import_foreign_remote(toks, p)
            elif v in ('grant', 'revoke'):
                if _at_statement_start(toks, p, self.spec):
                    self.grant(toks, p, 'GRANT' if v == 'grant' else 'REVOKE')
            elif v == 'execute':
                self.execute(toks, p, prev)
            elif v == 'into':
                self.select_into(toks, p, prev)
            elif v == 'set':
                if _at_statement_start(toks, p, self.spec):
                    self.set_search_path(toks, p)
            elif v == 'reset':
                if _at_statement_start(toks, p, self.spec) and (_word_at(toks, p + 1, 'search_path') or _word_at(toks, p + 1, 'all')):
                    self.state['search_path'] = None
            elif v == 'set_config':
                self.set_config(toks, p)
            else:
                nx = _get(toks, p + 1)
                if v in sql['postgis_functions'] and nx is not None and _t(nx) == 'LPAREN':
                    self.postgis_function(toks, p, sql['postgis_functions'][v])
                elif v in sql['dynamic_exec_functions'] and nx is not None and _t(nx) == 'LPAREN':
                    end = _match_paren(toks, p + 1)
                    inner = toks[p + 2:end]
                    if any(not (_t(x) in ('STRING', 'COMMA') or (_t(x) == 'OP' and _v(x) == '||')) for x in inner):
                        self.unres('DYNAMIC_SQL', f'{v}() with a non-constant argument runs SQL the text does not contain')

    def drop(self, toks, p):
        sql = self.spec['sql']
        kind = _match_kind(toks, p + 1, sql['relation_object_kinds'])

        def if_exists(k):
            return k + 2 if _words_at(toks, k, ['if', 'exists']) else k

        if kind:
            self.lst(toks, p, if_exists(p + 1 + len(kind)), 'DROP')
            return
        if _word_at(toks, p + 1, 'schema'):
            self.lst(toks, p, if_exists(p + 2), 'DROP_SCHEMA', schema=True)
            return
        unresolvable = _match_kind(toks, p + 1, sql['drop_unresolvable_object_kinds'])
        if unresolvable:
            if _at_statement_start(toks, p, self.spec):
                self.unres('DROP_' + '_'.join(unresolvable).upper(),
                           f"DROP {' '.join(unresolvable).upper()} can drop protected relations no name shows")
            return
        nx = _get(toks, p + 1)
        if nx is not None and _t(nx) == 'WORD' and _v(nx) in sql['drop_on_object_kinds']:
            name, end = _parse_name_at(toks, if_exists(p + 2), self.spec)
            if name is not None and _word_at(toks, end, 'on'):
                self.one(toks, p, end + 1, 'ALTER', only=True)
            elif _at_statement_start(toks, p, self.spec):
                self.unres('ALTER', f'DROP {_v(nx).upper()} without a static ON relation')

    def update(self, toks, p, prev):
        if prev is not None and prev in self.spec['sql']['update_not_after']:
            return
        if _word_at(toks, p + 1, 'set'):
            return
        name, k = _parse_name_at(toks, p + 1, self.spec, only=True, star=True)
        if name is not None:
            if _word_at(toks, k, 'as'):
                k += 1
            if _get(toks, k) is not None and _t(toks[k]) == 'WORD' and _v(toks[k]) != 'set':
                k += 1
            if _word_at(toks, k, 'set'):
                self.target('UPDATE', name)
                return
        if _at_statement_start(toks, p, self.spec):
            self.unres('UPDATE', f'UPDATE target is not a static relation name: {_describe_at(toks, p)}')

    def copy(self, toks, p):
        # U30F5 (D-3): FROM PROGRAM / TO PROGRAM runs a shell command on the database server, whatever the table
        if any(_t(x) == 'WORD' and _v(x) == 'program' and (_word_at(toks, n - 1, 'from') or _word_at(toks, n - 1, 'to')) for n, x in enumerate(toks) if n > p):
            self.unres('COPY_PROGRAM', 'COPY ... PROGRAM runs a shell command on the database server')
        nx = _get(toks, p + 1)
        if nx is not None and _t(nx) == 'LPAREN':
            return
        name, k = _parse_name_at(toks, p + 1, self.spec)
        if name is not None:
            if _get(toks, k) is not None and _t(toks[k]) == 'LPAREN':
                k = _match_paren(toks, k) + 1
            if _word_at(toks, k, 'from'):
                self.target('COPY_FROM', name)
            return
        if any(_t(x) == 'WORD' and _v(x) == 'from' for x in toks[p + 1:]):
            self.unres('COPY_FROM', f'COPY target is not a static relation name: {_describe_at(toks, p)}')

    def alter(self, toks, p):
        kind = _match_kind(toks, p + 1, self.spec['sql']['relation_object_kinds'])
        if kind:
            k = p + 1 + len(kind)
            if _words_at(toks, k, ['if', 'exists']):
                k += 2
            if _words_at(toks, k, ['all', 'in', 'tablespace']):
                self.unres('ALTER', 'ALTER ... ALL IN TABLESPACE moves relations no name shows')
                return
            name, end = _parse_name_at(toks, k, self.spec, only=True, star=True)
            if name is None:
                if _at_statement_start(toks, p, self.spec):
                    self.unres('ALTER', f'ALTER target is not a static relation name: {_describe_at(toks, p)}')
                return
            rest = toks[end:]
            # U30F5 (D-4): OPTIONS, RENAME TO or SET SCHEMA of a foreign table can change the remote relation it writes
            if len(kind) == 2 and kind[0] == 'foreign':
                if any(_t(x) == 'WORD' and ((_v(x) == 'options' and _get(rest, n + 1) is not None and _t(rest[n + 1]) == 'LPAREN')
                                            or (_v(x) == 'rename' and _word_at(rest, n + 1, 'to'))
                                            or (_v(x) == 'set' and _word_at(rest, n + 1, 'schema'))) for n, x in enumerate(rest)):
                    self.unres('WRITE_PATH', 'ALTER FOREIGN TABLE changes the remote relation it writes through to')
            rename_at = next((n for n, x in enumerate(rest) if _t(x) == 'WORD' and _v(x) == 'rename' and _word_at(rest, n + 1, 'to')), -1)
            if rename_at >= 0:
                to = _parse_name_at(rest, rename_at + 2, self.spec)[0]
                self.target('RENAME', name)
                if to is not None:
                    self.target('RENAME', (name[0], to[1]))
                else:
                    self.unres('RENAME', 'RENAME TO a name that is not static')
                return
            self.target('ALTER', name)
            # U30F3 M-1: ATTACH/DETACH PARTITION <child> and [NO] INHERIT <parent> change that relation too
            for n, x in enumerate(rest):
                if _t(x) != 'WORD':
                    continue
                at = -1
                if _v(x) in ('attach', 'detach') and _word_at(rest, n + 1, 'partition'):
                    at = n + 2
                elif _v(x) == 'inherit':
                    at = n + 1
                if at < 0:
                    continue
                other = _parse_name_at(rest, at, self.spec)[0]
                if other is not None:
                    self.target('ALTER', other)
                else:
                    self.unres('ALTER', f'{_v(x).upper()} of a relation that is not static')
            set_schema_at = next((n for n, x in enumerate(rest) if _t(x) == 'WORD' and _v(x) == 'set' and _word_at(rest, n + 1, 'schema')), -1)
            if set_schema_at >= 0:
                dest = _parse_name_at(rest, set_schema_at + 2, self.spec)[0]
                if dest is not None and dest[0] is None:
                    self.target('ALTER', (dest[1], name[1]))
                else:
                    self.unres('ALTER', 'SET SCHEMA to a schema that is not static')
            return
        if _word_at(toks, p + 1, 'schema'):
            name, end = _parse_name_at(toks, p + 2, self.spec)
            if name is None or name[0] is not None:
                if _at_statement_start(toks, p, self.spec):
                    self.unres('ALTER_SCHEMA', f'ALTER SCHEMA target is not a static schema name: {_describe_at(toks, p)}')
                return
            if _words_at(toks, end, ['rename', 'to']):
                to = _parse_name_at(toks, end + 2, self.spec)[0]
                self.target('RENAME_SCHEMA', name, 'SCHEMA')
                if to is not None and to[0] is None:
                    self.target('RENAME_SCHEMA', to, 'SCHEMA')
                else:
                    self.unres('RENAME_SCHEMA', 'RENAME TO a schema name that is not static')
            else:
                self.target('ALTER_SCHEMA', name, 'SCHEMA')
            return
        # U30F5 (B8): ALTER DEFAULT PRIVILEGES [FOR ROLE r] [IN SCHEMA s, ...] -- without IN SCHEMA it applies to every schema
        if _words_at(toks, p + 1, ['default', 'privileges']):
            in_at = next((n for n in range(p + 3, len(toks)) if _t(toks[n]) == 'WORD' and _v(toks[n]) == 'in' and _word_at(toks, n + 1, 'schema')), -1)
            if in_at >= 0:
                self.lst(toks, p, in_at + 2, 'DEFAULT_PRIVILEGES', schema=True)
            elif _at_statement_start(toks, p, self.spec):
                self.unres('DEFAULT_PRIVILEGES', 'ALTER DEFAULT PRIVILEGES without IN SCHEMA applies to every schema')
            return
        # U30F5 (B8): ALTER ROLE / USER / GROUP (not USER MAPPING) can grant SUPERUSER, BYPASSRLS or a membership
        if (_word_at(toks, p + 1, 'role') or _word_at(toks, p + 1, 'group') or (_word_at(toks, p + 1, 'user') and not _word_at(toks, p + 2, 'mapping'))) \
                and _at_statement_start(toks, p, self.spec):
            self.unres('ROLE', 'a role change can lift the database-level protection of the protected relations')

    def grant(self, toks, p, op):
        # U30F5 (B8): GRANT/REVOKE ... ON <relations> | ON ALL TABLES IN SCHEMA <s> | ON SCHEMA <s>; other object kinds name
        # no relation; without ON it is a role membership
        end = 'to' if op == 'GRANT' else 'from'
        depth = 0
        on_at = -1
        end_at = -1
        for k in range(p + 1, len(toks)):
            x = toks[k]
            if _t(x) == 'LPAREN':
                depth += 1
            elif _t(x) == 'RPAREN':
                depth -= 1
            elif depth == 0 and _t(x) == 'WORD' and _v(x) == 'on':
                on_at = k
                break
            elif depth == 0 and _t(x) == 'WORD' and _v(x) == end:
                end_at = k
                break
        if on_at < 0:
            # GRANT <role> TO <role> (REVOKE ... FROM): a membership; without TO/FROM it is no privilege statement
            if end_at >= 0:
                self.unres('ROLE', f'{op} of a role membership can carry rights on the protected relations')
            return
        k = on_at + 1
        if _words_at(toks, k, ['all', 'tables', 'in', 'schema']):
            self.lst(toks, p, k + 4, op, schema=True)
        elif _word_at(toks, k, 'all'):
            return
        elif _word_at(toks, k, 'schema'):
            self.lst(toks, p, k + 1, op, schema=True)
        elif _word_at(toks, k, 'table'):
            self.lst(toks, p, k + 1, op)
        elif _get(toks, k) is not None and _t(toks[k]) == 'WORD' and _v(toks[k]) in self.spec['sql']['privilege_other_object_kinds']:
            return
        else:
            self.lst(toks, p, k, op)

    def import_foreign_remote(self, toks, p):
        # U30F5 (D-4): a write path to each LIMIT TO name of the remote schema, else to the whole remote schema
        remote, rend = _parse_name_at(toks, p + 3, self.spec)
        if remote is None or remote[0] is not None:
            self.unres('WRITE_PATH', 'IMPORT FOREIGN SCHEMA of a remote schema that is not static')
            return
        schema = remote[1]
        if _words_at(toks, rend, ['limit', 'to']) and _get(toks, rend + 2) is not None and _t(toks[rend + 2]) == 'LPAREN':
            close = _match_paren(toks, rend + 2)
            for arg in _split_args(toks[rend + 3:close]):
                name, nend = _parse_name_at(arg, 0, self.spec)
                if name is not None and name[0] is None and nend == len(arg):
                    self.target('WRITE_PATH', (schema, name[1]))
                else:
                    self.unres('WRITE_PATH', 'IMPORT FOREIGN SCHEMA LIMIT TO a name that is not static')
            return
        self.target('WRITE_PATH', (None, schema), 'SCHEMA')

    def foreign_table(self, rest, local):
        # U30F5 (D-4): a foreign table writes through to its remote relation (OPTIONS schema_name / table_name, each
        # defaulting to the foreign table's own schema and name); a value that is not a constant string is unresolved
        names = self.spec['sql']['foreign_table_remote_options']
        depth = 0
        server_at = -1
        for n, x in enumerate(rest):
            if _t(x) == 'LPAREN':
                depth += 1
            elif _t(x) == 'RPAREN':
                depth -= 1
            elif depth == 0 and _t(x) == 'WORD' and _v(x) == 'server':
                server_at = n
                break
        schema, table = local
        not_static = False
        options_at = -1 if server_at < 0 else next((n for n in range(server_at + 1, len(rest)) if _t(rest[n]) == 'WORD' and _v(rest[n]) == 'options'
                                                     and _get(rest, n + 1) is not None and _t(rest[n + 1]) == 'LPAREN'), -1)
        if options_at >= 0:
            for arg in _split_args(rest[options_at + 2:_match_paren(rest, options_at + 1)]):
                key = arg[0] if len(arg) > 0 else None
                if key is None or _t(key) != 'WORD' or _v(key) not in (names['schema'], names['table']):
                    continue
                value = arg[1] if len(arg) > 1 else None
                if len(arg) != 2 or value is None or _t(value) != 'STRING' or _contains_dynamic(self.spec, _v(value)):
                    not_static = True
                    continue
                if _v(key) == names['schema']:
                    schema = _v(value)
                else:
                    table = _v(value)
        if not_static:
            self.unres('WRITE_PATH', 'a foreign table whose remote relation is not static')
        else:
            self.target('WRITE_PATH', (schema, table))

    def create(self, toks, p):
        sql = self.spec['sql']
        k = p + 1
        or_replace = False
        if _words_at(toks, k, ['or', 'replace']):
            or_replace = True
            k += 2
        while _get(toks, k) is not None and _t(toks[k]) == 'WORD' and _v(toks[k]) in sql['create_modifiers']:
            k += 1
        kind = _match_kind(toks, k, sql['relation_object_kinds'])
        if kind:
            k += len(kind)
            if _words_at(toks, k, ['if', 'not', 'exists']):
                k += 3
            name, end = _parse_name_at(toks, k, self.spec)
            if name is None:
                if _at_statement_start(toks, p, self.spec):
                    self.unres('CREATE', f'CREATE target is not a static relation name: {_describe_at(toks, p)}')
                return
            self.target('CREATE_OR_REPLACE' if or_replace else 'CREATE', name)
            rest = toks[end:]
            # U30F3 M-1: a (non-materialized) view is a write path to every relation its query reads
            if list(kind) == ['view']:
                self.write_path(rest, _after_defining_as(rest))
            if len(kind) == 2 and kind[0] == 'foreign':
                self.foreign_table(rest, name)
            partition_of = next((n for n, x in enumerate(rest) if _t(x) == 'WORD' and _v(x) == 'partition' and _word_at(rest, n + 1, 'of')), -1)
            if partition_of >= 0:
                parent = _parse_name_at(rest, partition_of + 2, self.spec)[0]
                if parent is not None:
                    self.target('ALTER', parent)
                else:
                    self.unres('ALTER', 'PARTITION OF a parent that is not static')
            inherits = next((n for n, x in enumerate(rest) if _t(x) == 'WORD' and _v(x) == 'inherits' and _get(rest, n + 1) is not None and _t(rest[n + 1]) == 'LPAREN'), -1)
            if inherits >= 0:
                n = inherits + 2
                while True:
                    parent, pend = _parse_name_at(rest, n, self.spec)
                    if parent is None:
                        self.unres('ALTER', 'INHERITS a parent that is not static')
                        break
                    self.target('ALTER', parent)
                    if _get(rest, pend) is None or _t(rest[pend]) != 'COMMA':
                        break
                    n = pend + 1
            return
        if _word_at(toks, k, 'constraint') and _word_at(toks, k + 1, 'trigger'):
            k += 1
        obj = _v(toks[k]) if _get(toks, k) is not None and _t(toks[k]) == 'WORD' else None
        # U30F5 (B8): CREATE ROLE/USER/GROUP with an option that carries rights or a membership (not CREATE USER MAPPING)
        if (obj in ('role', 'group') or (obj == 'user' and not _word_at(toks, k + 1, 'mapping'))) and _at_statement_start(toks, p, self.spec):
            if any(_t(x) == 'WORD' and _v(x) in sql['role_options_unresolvable'] for n, x in enumerate(toks) if n > k + 1):
                self.unres('ROLE', 'a role created with rights or a membership can lift the database-level protection')
            return
        if obj in ('trigger', 'policy', 'rule'):
            anchor = 'to' if obj == 'rule' else 'on'
            at = next((n for n in range(k + 2, len(toks)) if _t(toks[n]) == 'WORD' and _v(toks[n]) == anchor), -1)
            name = None if at < 0 else _parse_name_at(toks, at + 1, self.spec, only=True)[0]
            if name is not None:
                self.target('ALTER', name)
            elif _at_statement_start(toks, p, self.spec):
                self.unres('ALTER', f'CREATE {obj.upper()} on a relation that is not static')
            # U30F3 M-1: an ON SELECT ... DO INSTEAD SELECT rule makes its relation a view of what the action reads
            if obj == 'rule':
                on = next((n for n in range(k + 2, len(toks)) if _t(toks[n]) == 'WORD' and _v(toks[n]) == 'on'), -1)
                do_at = next((n for n in range(on + 2, len(toks)) if _t(toks[n]) == 'WORD' and _v(toks[n]) == 'do'), -1) if on >= 0 and _word_at(toks, on + 1, 'select') else -1
                if do_at >= 0:
                    self.write_path(toks, do_at + 1)

    def write_path(self, defn, start):
        # U30F3 M-1: every static relation name of a view's query / ON SELECT rule action is a WRITE_PATH target
        dynamic = False
        k = start
        while k < len(defn):
            x = defn[k]
            if _t(x) == 'DYN':
                dynamic = True
            if _t(x) not in ('WORD', 'QIDENT'):
                k += 1
                continue
            prev = defn[k - 1] if k > 0 else None
            if prev is not None and (_t(prev) == 'DOT' or (_t(prev) == 'WORD' and _v(prev) == 'as') or (_t(prev) == 'OP' and _v(prev) == '::')):
                k += 1
                continue
            name, end = _parse_name_at(defn, k, self.spec)
            if name is None:
                k += 1
                continue
            nx = _get(defn, end)
            if nx is None or _t(nx) != 'LPAREN':
                self.target('WRITE_PATH', name)
            k = max(end, k + 1)
        if dynamic:
            self.unres('WRITE_PATH', 'a view or rule over a relation that is not static')

    def execute(self, toks, p, prev):
        sql = self.spec['sql']
        if prev is not None and prev in sql['execute_not_after']:
            return
        nx = _get(toks, p + 1)
        if nx is not None and _t(nx) == 'WORD' and _v(nx) in sql['execute_not_before']:
            return
        if not _at_statement_start(toks, p, self.spec):
            return
        expr = []
        for x in toks[p + 1:]:
            if _t(x) == 'WORD' and _v(x) in ('using', 'into'):
                break
            expr.append(x)
        constant = len(expr) > 0 and all((_t(x) == 'STRING') if n % 2 == 0 else (_t(x) == 'OP' and _v(x) == '||') for n, x in enumerate(expr))
        if not constant:
            self.unres('DYNAMIC_SQL', f'EXECUTE of a non-constant expression: {_describe_at(toks, p)}')

    def select_into(self, toks, p, prev):
        if prev in ('insert', 'merge'):
            return
        if not any(_t(x) == 'WORD' and _v(x) == 'select' for x in toks[:p]):
            return
        k = p + 1
        while _get(toks, k) is not None and _t(toks[k]) == 'WORD' and _v(toks[k]) in ('temp', 'temporary', 'unlogged', 'table'):
            k += 1
        name = _parse_name_at(toks, k, self.spec)[0]
        if name is not None:
            self.target('CREATE', name)

    def path_values(self, values):
        if len(values) == 1 and _t(values[0]) == 'WORD' and _v(values[0]) == 'default':
            return None
        path = []
        for x in values:
            if _t(x) == 'COMMA':
                continue
            if _t(x) == 'WORD':
                path.append(_v(x))
            elif _t(x) == 'QIDENT' and not x[3]:
                path.append(_v(x))
            elif _t(x) == 'STRING':
                for part in _v(x).split(','):
                    name = parse_relation_name(part)
                    if len(part.strip()) == 0:
                        continue
                    if name is None or name[0] is not None:
                        return 'UNKNOWN'
                    path.append(name[1])
            else:
                return 'UNKNOWN'
        return [s for s in path if s not in ('$user', 'pg_temp', 'pg_catalog')]

    def set_search_path(self, toks, p):
        k = p + 1
        if _word_at(toks, k, 'session') or _word_at(toks, k, 'local'):
            k += 1
        if _word_at(toks, k, 'schema'):
            self.state['search_path'] = self.path_values(toks[k + 1:])
            return
        if not _word_at(toks, k, 'search_path'):
            return
        k += 1
        if _word_at(toks, k, 'to') or (_get(toks, k) is not None and _t(toks[k]) == 'OP' and _v(toks[k]) == '='):
            k += 1
        self.state['search_path'] = self.path_values(toks[k:])

    def set_config(self, toks, p):
        nx = _get(toks, p + 1)
        if nx is None or _t(nx) != 'LPAREN':
            return
        end = _match_paren(toks, p + 1)
        args = _split_args(toks[p + 2:end])
        first = args[0] if args else None
        if first is None or len(first) != 1 or _t(first[0]) != 'STRING':
            if first is not None and any(_t(x) != 'STRING' for x in first):
                self.state['search_path'] = 'UNKNOWN'
            return
        if _ascii_lower(_v(first[0]).strip()) != 'search_path':
            return
        second = args[1] if len(args) > 1 else None
        self.state['search_path'] = self.path_values(second) if second is not None and len(second) == 1 and _t(second[0]) == 'STRING' else 'UNKNOWN'

    def postgis_function(self, toks, p, op):
        end = _match_paren(toks, p + 1)
        args = []
        for a in _split_args(toks[p + 2:end]):
            n = len(a)
            while n >= 2 and _t(a[n - 2]) == 'OP' and _v(a[n - 2]) == '::' and _t(a[n - 1]) == 'WORD':
                n -= 2
            args.append(a[:n])
        dyn_open = self.spec['dynamic_placeholder_open']
        if len(args) == 0 or any(len(a) != 1 or _t(a[0]) not in ('STRING', 'NUMBER') or dyn_open in _v(a[0]) for a in args):
            self.unres(op, f'{_v(toks[p])}() without constant arguments: the relation it changes is not static')
            return
        strings = [_v(a[0]) for a in args if _t(a[0]) == 'STRING']
        for s in strings:
            name = parse_relation_name(s)
            if name is not None:
                self.target(op, name)
        for n in range(len(strings) - 1):
            self.target(op, (strings[n], strings[n + 1]))


def _analyze_sql_at(sql, depth, spec):
    toks, error = tokenize_sql(sql, spec)
    if error:
        return [], [('PARSE', f'{error}: the text cannot be read as SQL')], False
    targets, unresolved = [], []
    nested_changed = False
    dyn = spec['dynamic_placeholder_open'] + spec['dynamic_placeholder_close']
    for text in _embedded_texts(toks, dyn, spec):
        if depth + 1 > spec['sql']['max_nesting']:
            unresolved.append(('DYNAMIC_SQL', 'SQL nested in literals deeper than the classifier reads'))
            continue
        t2, u2, ch = _analyze_sql_at(text, depth + 1, spec)
        targets += t2
        unresolved += u2
        if ch:
            nested_changed = True
    state = {'search_path': 'UNKNOWN' if nested_changed else None}
    an = _SqlAnalyzer(state, spec)
    changed = nested_changed
    for st in _split_statements(toks):
        before = state['search_path']
        an.statement(st)
        if state['search_path'] != before:
            changed = True
    return targets + an.targets, unresolved + an.unresolved, changed


def analyze_sql(sql, spec=None):
    """(targets [(op, scope, (schema, table))], unresolved [(op, reason)])"""
    spec = spec or load_spec()
    t, u, _ = _analyze_sql_at(sql, 0, spec)
    return t, u


# ------------------------------------------------------------------------------------------------
# ogr2ogr (ProtectedWriteClassifier.ts analyzeOgr2ogrArgs)
# ------------------------------------------------------------------------------------------------

def _flag_values(args, flags, ignore_case=False):
    values = []
    missing = False
    for i, a in enumerate(args):
        key = _ascii_lower(a.strip()) if ignore_case else a.strip()
        if key not in flags:
            continue
        if i + 1 < len(args):
            values.append(args[i + 1])
        else:
            missing = True
    return values, missing


def _is_pg_datasource(a, spec):
    lower = _ascii_lower(a.strip())
    return any(lower.startswith(p) for p in spec['ogr2ogr']['database_datasource_prefixes'])


_OPTION_RE = re.compile(r'([A-Za-z_]+)\s*=\s*(\'([^\']*)\'|"([^"]*)"|([^\s\'"]+))')


def _option_values(text, keys):
    out = []
    for m in _OPTION_RE.finditer(text):
        if _ascii_lower(m.group(1)) in keys:
            out.append(m.group(3) if m.group(3) is not None else m.group(4) if m.group(4) is not None else m.group(5) or '')
    return out


def analyze_ogr2ogr_args(args, spec=None):
    """(targets, unresolved, database)"""
    spec = spec or load_spec()
    o = spec['ogr2ogr']
    targets, unresolved = [], []
    formats = [_ascii_lower(f.strip()) for f in _flag_values(args, o['format_flags'], True)[0]]
    for sql_text in _flag_values(args, o['sql_flags'], True)[0]:
        if sql_text.strip().startswith('@'):
            unresolved.append(('DYNAMIC_SQL', 'ogr2ogr -sql @file runs SQL the arguments do not contain'))
        else:
            t, u = analyze_sql(sql_text, spec)
            targets += t
            unresolved += u
    pg_sources = [a for a in args if _is_pg_datasource(a, spec)]
    nln = _flag_values(args, o['layer_name_flags'], True)[0]
    dynamic_only = any(_dynamic_hint(spec, a) is not None for a in args)
    if formats:
        database = any(f in o['database_formats'] or f in o['sql_dump_formats'] or _dynamic_hint(spec, f) is not None for f in formats)
    else:
        database = len(pg_sources) > 0 or (dynamic_only and len(nln) > 0)
    if not database:
        return targets, unresolved, False
    if not nln:
        unresolved.append(('OGR2OGR_WRITE', 'a PostgreSQL ogr2ogr write without -nln takes its table name from the source'))
        return targets, unresolved, True
    schemas = []
    for v in _flag_values(args, o['layer_creation_flags'], True)[0]:
        schemas += _option_values(v, o['schema_options'])
    for v in _flag_values(args, o['destination_open_flags'], True)[0]:
        for s in _option_values(v, o['active_schema_options']):
            schemas += s.split(',')
    for ds in pg_sources:
        for s in _option_values(ds, o['active_schema_options']):
            schemas += s.split(',')
    for value in nln:
        name = parse_relation_name(value)
        if name is None:
            unresolved.append(('OGR2OGR_WRITE', f'-nln {value} is not a static relation name'))
            continue
        targets.append(('OGR2OGR_WRITE', 'RELATION', name))
        if name[0] is not None:
            continue
        for raw in schemas:
            schema = parse_relation_name(raw)
            if schema is None or schema[0] is not None:
                unresolved.append(('OGR2OGR_WRITE', f'schema {raw} is not a static schema name'))
                continue
            targets.append(('OGR2OGR_WRITE', 'RELATION', (schema[1], name[1])))
    return targets, unresolved, True


# ------------------------------------------------------------------------------------------------
# Command lines (ProtectedWriteClassifier.ts splitCommandLine / analyzeCommand*)
# ------------------------------------------------------------------------------------------------

def _cmd_variable(s):
    # A cmd variable at the start of s, as (matched text, hint): %NAME%, and (U30F5 D-5) a FOR loop variable
    # %%i / %%~nxi and a batch argument %1 / %~dp0 / %* -- values the command line does not hold
    m = re.match(r'%([A-Za-z_][A-Za-z0-9_]*)%', s)
    if m:
        return m.group(0), m.group(1)
    # U30F9: cmd delayed expansion !NAME! is a value too
    m = re.match(r'!([A-Za-z_][A-Za-z0-9_]*)!', s)
    if m:
        return m.group(0), m.group(1)
    m = re.match(r'%%(?:~[A-Za-z]*)?([A-Za-z])', s)
    if m:
        return m.group(0), m.group(1)
    m = re.match(r'%(?:~[A-Za-z]*)?([0-9*])', s)
    if m:
        return m.group(0), '' if m.group(1) == '*' else m.group(1)
    return None


def split_command_line(command, spec=None):
    """[[{'argv': [...], 'stdin': str|None, 'stdin_file': str|None}]] (pipelines of segments)"""
    spec = spec or load_spec()

    def dyn(hint):
        return _dyn(spec, hint)

    pipelines = []
    st = {'pipeline': [], 'argv': [], 'stdin': None, 'stdin_file': None, 'tok': '', 'started': False,
          'here_string': False, 'expect_stdin_file': False, 'skip_next': False}
    # U30F8 (G6-1): an unquoted delimiter expands the body; U30F9 (G8-6): EVERY here-document opened on the line, in order --
    # each body goes to the segment that opened it (`cat <<A; psql <<B`: A's body for cat, B's for psql)
    pending_heredocs = []
    # U30F8: the commands of $(...), <(...), >(...) and here-document backticks run too -- split as pipelines of their own
    nested = []

    def end_token():
        if st['started']:
            if st['skip_next']:
                st['skip_next'] = False
            elif st['here_string']:
                st['stdin'] = st['tok']  # U30F8 (G6-1): cmd <<< word -- the word is stdin
                st['here_string'] = False
            elif st['expect_stdin_file']:
                st['stdin_file'] = st['tok']
                st['expect_stdin_file'] = False
            else:
                st['argv'].append(st['tok'])
        st['tok'] = ''
        st['started'] = False

    def end_segment():
        end_token()
        if st['argv'] or st['stdin'] is not None:
            seg = {'argv': st['argv'], 'stdin': st['stdin'], 'stdin_file': st['stdin_file']}
            st['pipeline'].append(seg)
            for h in pending_heredocs:
                if h['seg'] is None:
                    h['seg'] = seg
        st['argv'] = []
        st['stdin'] = None
        st['stdin_file'] = None

    def end_pipeline():
        end_segment()
        if st['pipeline']:
            pipelines.append(st['pipeline'])
        st['pipeline'] = []

    def read_variable(s, i):
        # U30F9 (G8-4): GitHub Actions `${{ expression }}` is one value, whatever the expression holds
        if _at(s, i + 1) == '{' and _at(s, i + 2) == '{':
            end = s.find('}}', i + 3)
            return dyn(s[i + 3:(len(s) if end < 0 else end)]), (len(s) if end < 0 else end + 2)
        if _at(s, i + 1) == '(':
            depth = 0
            for j in range(i + 1, len(s)):
                if s[j] == '(':
                    depth += 1
                elif s[j] == ')':
                    depth -= 1
                    if depth == 0:
                        if _at(s, i + 2) != '(':
                            nested.append(s[i + 2:j])
                        return dyn(''), j + 1
            if _at(s, i + 2) != '(':
                nested.append(s[i + 2:])
            return dyn(''), len(s)
        if _at(s, i + 1) == '{':
            end = s.find('}', i + 2)
            return dyn(s[i + 2:(len(s) if end < 0 else end)]), (len(s) if end < 0 else end + 1)
        m = re.match(r'[A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)?', s[i + 1:])
        if m:
            return dyn(re.sub(r'^env:', '', m.group(0), flags=re.IGNORECASE)), i + 1 + len(m.group(0))
        # U30F6 (F5-1): a positional or special parameter ($1..$9, $@, $*, $#, $?, $$, $!, $0, $-) is a value too
        if re.match(r'[0-9@*#?$!-]', s[i + 1:i + 2]):
            return dyn(s[i + 1]), i + 2
        return None

    def expand_body(body):
        # U30F8 (G6-1): the body of an unquoted here-document as the shell expands it -- every expansion is a value
        out = ''
        j = 0
        while j < len(body):
            ch = body[j]
            if ch == '\\' and _at(body, j + 1) in ('$', '`', '\\') and _at(body, j + 1) != '':
                out += body[j + 1]
                j += 2
                continue
            if ch == '$':
                v = read_variable(body, j)
                if v:
                    out += v[0]
                    j = v[1]
                    continue
            if ch == '`':
                end = body.find('`', j + 1)
                nested.append(body[j + 1:(len(body) if end < 0 else end)])
                out += dyn('')
                j = len(body) if end < 0 else end + 1
                continue
            out += ch
            j += 1
        return out

    def skip_parens(text, open_at):
        # U30F8 (G6-1): <(...) / >(...) -- process substitution; the index after it
        depth = 0
        for j in range(open_at, len(text)):
            if text[j] == '(':
                depth += 1
            elif text[j] == ')':
                depth -= 1
                if depth == 0:
                    return j + 1
        return len(text)

    def read_backtick(text, i):
        # U30F9 (G8-1): `...` outside a here-document is a command substitution like $(...): its command runs, its output is
        # a value; a backtick with no closing one is text (a PowerShell `n in a string)
        end = text.find('`', i + 1)
        if end < 0:
            return None
        nested.append(text[i + 1:end])
        return dyn(''), end + 1

    def read_template(text, i):
        # U30F9: `{{ ... }}` is a template placeholder (Taskfile, Helm, Go templates): a value the text does not hold
        if not text.startswith('{{', i):
            return None
        end = text.find('}}', i + 2)
        return dyn('template'), (len(text) if end < 0 else end + 2)

    s = command
    i = 0
    n = len(s)
    while i < n:
        c = s[i]
        if c == "'":
            end = s.find("'", i + 1)
            st['tok'] += s[i + 1:(n if end < 0 else end)]
            st['started'] = True
            i = n if end < 0 else end + 1
            continue
        if c == '"':
            j = i + 1
            while j < n and s[j] != '"':
                if s[j] in ('\\', '`') and _at(s, j + 1) in ('"', '\\', '`', '$') and _at(s, j + 1) != '':
                    st['tok'] += s[j + 1]
                    j += 2
                    continue
                if s[j] == '`':
                    b = read_backtick(s, j)
                    if b:
                        st['tok'] += b[0]
                        j = b[1]
                        continue
                if s[j] == '$':
                    v = read_variable(s, j)
                    if v:
                        st['tok'] += v[0]
                        j = v[1]
                        continue
                if s[j] in ('%', '!'):
                    m = _cmd_variable(s[j:])
                    if m:
                        st['tok'] += dyn(m[1])
                        j += len(m[0])
                        continue
                if s[j] == '{':
                    t = read_template(s, j)
                    if t:
                        st['tok'] += t[0]
                        j = t[1]
                        continue
                st['tok'] += s[j]
                j += 1
            st['started'] = True
            i = j + 1
            continue
        if c == '@' and _at(s, i + 1) in ("'", '"') and _at(s, i + 1) != '' and not st['started'] and (_at(s, i + 2) == '\n' or s[i + 2:i + 4] == '\r\n'):
            closer = '\n' + s[i + 1] + '@'
            end = s.find(closer, i + 2)
            body = re.sub(r'\r\Z', '', s[s.find('\n', i) + 1:(n if end < 0 else end)])
            if s[i + 1] == '"':
                body = re.sub(r'\$\{?[A-Za-z_][A-Za-z0-9_:]*\}?', lambda m: dyn(re.sub(r'[${}]', '', m.group(0))), body)
            st['tok'] += body
            st['started'] = True
            i = n if end < 0 else end + len(closer)
            continue
        if c in ('\\', '`', '^') and (_at(s, i + 1) == '\n' or (_at(s, i + 1) == '\r' and _at(s, i + 2) == '\n')):
            i += 3 if _at(s, i + 1) == '\r' else 2
            continue
        if c in ('\n', '\r'):
            if pending_heredocs:
                # the bodies follow in the order the markers stood; each goes to the segment that opened it
                consumed = i + 1
                queue = list(pending_heredocs)
                del pending_heredocs[:]
                for h in queue:
                    lines = s[consumed:].split('\n')
                    body = []
                    found = False
                    for line in lines:
                        consumed += len(line) + 1
                        if re.sub(r'\r\Z', '', line).strip() == h['delim']:
                            found = True
                            break
                        body.append(re.sub(r'\r\Z', '', line))
                    text = expand_body('\n'.join(body)) if h['expand'] else '\n'.join(body)
                    if h['seg'] is not None:
                        h['seg']['stdin'] = text
                    else:
                        st['stdin'] = text
                    if not found:
                        consumed = n
                        break
                end_pipeline()
                i = min(consumed, n)
                continue
            end_pipeline()
            i += 1
            continue
        if c in (' ', '\t'):
            end_token()
            i += 1
            continue
        if c == '|':
            if _at(s, i + 1) == '|':
                end_pipeline()
                i += 2
            else:
                end_segment()
                i += 1
            continue
        if c == '&':
            if _at(s, i + 1) == '&':
                end_pipeline()
                i += 2
                continue
            if not st['started'] and len(st['argv']) == 0:
                i += 1
                continue
            end_pipeline()
            i += 1
            continue
        if c == ';':
            end_pipeline()
            i += 1
            continue
        if c == '<':
            end_token()
            if _at(s, i + 1) == '(':
                st['tok'] += dyn('')
                st['started'] = True
                end = skip_parens(s, i + 1)
                nested.append(s[i + 2:max(i + 2, end - 1)])
                i = end
                continue
            if _at(s, i + 1) == '<':
                if _at(s, i + 2) == '<':
                    st['here_string'] = True
                    i += 3
                    continue
                m = re.match(r'<<-?\s*(\\?)([\'"]?)([A-Za-z_][A-Za-z0-9_]*)\2', s[i:])
                if m:
                    pending_heredocs.append({'delim': m.group(3), 'expand': m.group(1) == '' and m.group(2) == '', 'seg': None})
                    i += len(m.group(0))
                    continue
                i += 2
                continue
            st['expect_stdin_file'] = True
            i += 1
            continue
        if c == '>' and _at(s, i + 1) == '(':
            end_token()
            st['tok'] += dyn('')
            st['started'] = True
            end = skip_parens(s, i + 1)
            nested.append(s[i + 2:max(i + 2, end - 1)])
            i = end
            continue
        if c == '>':
            if re.fullmatch(r'[0-9]+', st['tok']):
                st['tok'] = ''
                st['started'] = False
            end_token()
            j = i + 1
            if _at(s, j) == '>':
                j += 1
            if _at(s, j) == '&':
                j += 1
                while j < n and re.match(r'[0-9]', s[j]):
                    j += 1
            else:
                st['skip_next'] = True
            i = j
            continue
        if c == '`':
            b = read_backtick(s, i)
            if b:
                st['tok'] += b[0]
                st['started'] = True
                i = b[1]
                continue
        if c == '$':
            v = read_variable(s, i)
            if v:
                st['tok'] += v[0]
                st['started'] = True
                i = v[1]
                continue
        if c in ('%', '!'):
            m = _cmd_variable(s[i:])
            if m:
                st['tok'] += dyn(m[1])
                st['started'] = True
                i += len(m[0])
                continue
        if c == '{':
            t = read_template(s, i)
            if t:
                st['tok'] += t[0]
                st['started'] = True
                i = t[1]
                continue
        st['tok'] += c
        st['started'] = True
        i += 1
    end_pipeline()
    for inner in nested:
        pipelines.extend(split_command_line(inner, spec))
    return pipelines


def _tool_base_name(arg):
    t = re.sub(r'^["\']+|["\']+\Z', '', arg.strip())
    parts = re.split(r'[\\/]', t)
    return _ascii_lower(parts[-1] if parts else '')


def unwrap_grouping(arg):
    # U30F4REP1: grouping glued to a token is not part of its name. Leading openers `(`, `{`, `@(` and `@{`
    # (any run) and trailing closers `)` / `}` at the absolute end.
    return re.sub(r'[)}]+\Z', '', re.sub(r'^(?:@?[({])+', '', arg))


def _strip_leading_openers(arg):
    # U30F4REP1 F4-2: leading grouping openers are not part of an assignment token. Closers stay.
    return re.sub(r'^(?:@?[({])+', '', arg)


def tool_of(arg, spec=None):
    spec = spec or load_spec()
    c = spec['commands']
    # U30G814F4 (F-4): grouping glued to the program is no part of its name -- openers `(psql`, `((psql`, `{psql`,
    # `@(psql` (sh/cmd subshell or group, PowerShell script block / array subexpression) and closers `psql)` / `psql}`
    unwrapped = unwrap_grouping(arg)
    hint = _dynamic_hint(spec, unwrapped)
    names = sorted(c['tools'].keys(), key=lambda x: (-len(x), x))
    if hint is not None:
        h = _ascii_lower(hint)
        for name in names:
            bare = re.sub(r'\.py$', '', name)
            if c['tools'][name] not in ('GDAL', 'PRISMA') and bare in h:
                return c['tools'][name]
        return None
    base = _tool_base_name(unwrapped)
    if base in c['tools']:
        return c['tools'][base]
    for suffix in c['tool_suffixes']:
        if base.endswith(suffix) and base[:-len(suffix)] in c['tools']:
            return c['tools'][base[:-len(suffix)]]
    return None


def _program_name(arg, spec):
    # a program's file name, lower-cased, without a tool suffix (.exe, .cmd, ...)
    base = _tool_base_name(unwrap_grouping(arg))
    for suffix in spec['commands']['tool_suffixes']:
        if base.endswith(suffix):
            base = base[:-len(suffix)]
    return base


def _shell_wrapper(arg, spec):
    c = spec['commands']
    base = _program_name(arg, spec)
    flags = c['shell_wrappers'].get(base)
    return (flags, base in c['shell_wrappers_rest_of_line']) if flags else None


def _requote(a):
    if not re.search(r'[\s"\'`$\\]', a):
        return a
    return '"' + ''.join('\\' + ch if ch in ('"', '\\', '`', '$') else ch for ch in a) + '"'


_GENERATORS = ('SHP2PGSQL', 'PG_DUMP', 'PG_RESTORE', 'OGR2OGR')


def _read_file_or_unresolved(targets, unresolved, path, read_sql_file, depth, spec):
    text = None if _contains_dynamic(spec, path) or read_sql_file is None else read_sql_file(path)
    if text is None:
        unresolved.append(('PSQL_FILE', f'SQL file {path} is not available to the classifier'))
        return
    if depth > spec['sql']['max_nesting']:
        unresolved.append(('PARSE', 'nesting'))
        return
    t, u = analyze_sql(text, spec)
    targets += t
    unresolved += u


def _pg_object_targets(targets, unresolved, rest, what, spec):
    c = spec['commands']['pg_restore']

    def collect(flags):
        values = _flag_values(rest, flags)[0]
        for a in rest:
            for f in flags:
                if f.startswith('--') and _ascii_lower(a).startswith(f + '='):
                    values.append(a[len(f) + 1:])
        return values

    tables = collect(c['table_flags'])
    schemas = collect(c['schema_flags'])
    if any(a in c['list_file_flags'] for a in rest):
        unresolved.append(('RESTORE', f'{what} with a list file restores objects the arguments do not name'))
        return
    if tables:
        for t in tables:
            name = parse_relation_name(t)
            if name is None:
                unresolved.append(('RESTORE', f'{what} table {t} is not a static name'))
                continue
            if name[0] is not None or not schemas:
                targets.append(('RESTORE', 'RELATION', name))
            for s in (schemas if name[0] is None else []):
                schema = parse_relation_name(s)
                if schema is None or schema[0] is not None:
                    unresolved.append(('RESTORE', f'{what} schema {s} is not static'))
                else:
                    targets.append(('RESTORE', 'RELATION', (schema[1], name[1])))
        return
    if schemas:
        for s in schemas:
            schema = parse_relation_name(s)
            if schema is None or schema[0] is not None:
                unresolved.append(('RESTORE_SCHEMA', f'{what} schema {s} is not static'))
            else:
                targets.append(('RESTORE_SCHEMA', 'SCHEMA', (None, schema[1])))
        return
    unresolved.append(('RESTORE', f'{what} without -t/-n writes every object of the archive'))


def _analyze_tool(tool, rest, ctx, read_sql_file, depth, spec):
    c = spec['commands']
    targets, unresolved = [], []
    if tool == 'OGR2OGR':
        t, u, _ = analyze_ogr2ogr_args(rest, spec)
        return t, u
    if tool == 'OGRINFO':
        for v in _flag_values(rest, c['ogrinfo']['sql_flags'], True)[0]:
            if v.strip().startswith('@'):
                unresolved.append(('DYNAMIC_SQL', 'ogrinfo -sql @file'))
            else:
                t, u = analyze_sql(v, spec)
                targets += t
                unresolved += u
        return targets, unresolved
    if tool == 'PSQL':
        has_sql = False
        i = 0
        while i < len(rest):
            a = rest[i]
            if a in c['psql']['command_flags']:
                has_sql = True
                if i + 1 < len(rest):
                    t, u = analyze_sql(rest[i + 1], spec)
                    targets += t
                    unresolved += u
                else:
                    unresolved.append(('PSQL_STDIN', 'psql -c without a command'))
                i += 2
                continue
            if a.startswith('--command='):
                has_sql = True
                t, u = analyze_sql(a[len('--command='):], spec)
                targets += t
                unresolved += u
            elif a in c['psql']['file_flags']:
                has_sql = True
                if i + 1 < len(rest):
                    _read_file_or_unresolved(targets, unresolved, rest[i + 1], read_sql_file, depth, spec)
                else:
                    unresolved.append(('PSQL_FILE', 'psql -f without a file'))
                i += 2
                continue
            elif a.startswith('--file='):
                has_sql = True
                _read_file_or_unresolved(targets, unresolved, a[len('--file='):], read_sql_file, depth, spec)
            elif a in c['psql']['value_flags']:
                i += 2
                continue
            i += 1
        if not has_sql:
            if ctx['stdin'] is not None:
                t, u = analyze_sql(ctx['stdin'], spec)
                targets += t
                unresolved += u
            elif ctx['stdin_file'] is not None:
                _read_file_or_unresolved(targets, unresolved, ctx['stdin_file'], read_sql_file, depth, spec)
            elif ctx['piped_from'] is None or ctx['piped_from'] not in _GENERATORS:
                unresolved.append(('PSQL_STDIN', 'psql reads SQL from stdin that the command line does not contain'))
        return targets, unresolved
    if tool == 'PG_RESTORE':
        if any(a in c['pg_restore']['list_only_flags'] for a in rest):
            return targets, unresolved
        _pg_object_targets(targets, unresolved, rest, 'pg_restore', spec)
        return targets, unresolved
    if tool == 'PG_DUMP':
        if ctx['pipes_to'] == 'PSQL':
            _pg_object_targets(targets, unresolved, rest, 'pg_dump | psql', spec)
        return targets, unresolved
    if tool == 'SHP2PGSQL':
        positionals = []
        i = 0
        while i < len(rest):
            a = rest[i]
            if a.startswith('-') and len(a) > 1:
                if a in c['shp2pgsql']['value_flags']:
                    i += 1
                i += 1
                continue
            positionals.append(a)
            i += 1
        if len(positionals) < 2:
            unresolved.append(('SHP2PGSQL_WRITE', 'shp2pgsql/raster2pgsql without a table takes the name from the file'))
            return targets, unresolved
        name = parse_relation_name(positionals[1])
        if name is not None:
            targets.append(('SHP2PGSQL_WRITE', 'RELATION', name))
        else:
            unresolved.append(('SHP2PGSQL_WRITE', f'table {positionals[1]} is not a static name'))
        return targets, unresolved
    if tool == 'GDAL':
        if any(_is_pg_datasource(a, spec) for a in rest):
            unresolved.append(('COMMAND', 'a GDAL tool with a PostgreSQL datasource writes relations the arguments do not name'))
        return targets, unresolved
    # U30F3 M-2: destructive database CLI entry points
    if tool == 'PGBENCH':
        # U30F6 (F5-5): pgbench runs the SQL of each -f/--file script (name@weight)
        files = list(_flag_values(rest, c['pgbench']['file_flags'])[0])
        files += [a[len('--file='):] for a in rest if _ascii_lower(a).startswith('--file=')]
        for f in files:
            _read_file_or_unresolved(targets, unresolved, re.sub(r'@[0-9]+$', '', f), read_sql_file, depth, spec)
        return targets, unresolved
    if tool == 'DROPDB':
        unresolved.append(('DROP_DATABASE', 'dropdb drops a whole database, every protected relation in it'))
        return targets, unresolved
    if tool == 'LOADER':
        unresolved.append(('COMMAND', 'a loader (pgloader, osm2pgsql, qgis_process) writes relations, or runs SQL, that its arguments do not name statically'))
        return targets, unresolved
    if tool == 'PRISMA':
        words = [_ascii_lower(a) for a in rest if not a.startswith('-')]
        for sub in c['prisma']['unresolvable_subcommands']:
            if all(n < len(words) and words[n] == w for n, w in enumerate(sub)):
                unresolved.append(('COMMAND', f"prisma {' '.join(sub)} changes the database outside any classified SQL"))
                return targets, unresolved
        for sub in c['prisma']['file_executing_subcommands']:
            if not all(n < len(words) and words[n] == w for n, w in enumerate(sub)):
                continue
            if any(_ascii_lower(a) in c['prisma']['stdin_flags'] for a in rest):
                unresolved.append(('PSQL_STDIN', f"prisma {' '.join(sub)} --stdin"))
                return targets, unresolved
            files = _flag_values(rest, c['prisma']['file_flags'])[0]
            for a in rest:
                if _ascii_lower(a).startswith('--file='):
                    files.append(a[len('--file='):])
            if not files:
                unresolved.append(('PSQL_FILE', f"prisma {' '.join(sub)} without --file"))
            for f in files:
                _read_file_or_unresolved(targets, unresolved, f, read_sql_file, depth, spec)
            return targets, unresolved
        return targets, unresolved
    return targets, unresolved


def _write_capable(tool, rest, ctx, spec):
    # U30F9 default-deny: whether this invocation of a DB/GIS tool can write a database at all -- decided by the tool's own
    # explicit flags, never by what a value might hold (see ProtectedWriteClassifier.ts writeCapable)
    c = spec['commands']
    exempt_unless = c['non_literal_exempt_tools_unless_piped_to'].get(tool)
    if exempt_unless is not None:
        return ctx['pipes_to'] == exempt_unless
    if tool == 'OGRINFO':
        lower = [_ascii_lower(a.strip()) for a in rest]
        return any(f in lower for f in c['ogrinfo']['sql_flags']) and not any(f in lower for f in c['ogrinfo']['read_only_flags'])
    if tool == 'GDAL':
        # (the format values are read for a placeholder BEFORE lower-casing: a placeholder is recognised in its own spelling only)
        given = _flag_values(rest, spec['ogr2ogr']['format_flags'], True)[0]
        formats = [_ascii_lower(f.strip()) for f in given]
        positional = [a for a in rest if not a.startswith('-')]
        destination = positional[-1] if positional else None
        return any(_is_pg_datasource(a, spec) for a in rest) or any(_contains_dynamic(spec, f) for f in given) \
            or any(f in spec['ogr2ogr']['database_formats'] or 'postgis' in f for f in formats) \
            or (not given and destination is not None and _contains_dynamic(spec, destination))  # no format named: the destination may be PG:
    if tool == 'OGR2OGR':
        return analyze_ogr2ogr_args(rest, spec)[2]
    if tool == 'PRISMA':
        words = [_ascii_lower(a) for a in rest if not a.startswith('-')]
        return (words[0] if words else '') in c['prisma']['database_subcommands']
    return True


def _env_assignment_at(argv, i, spec):
    # U30G814 (G8-14): the environment assignment at argv[i] -- NAME=value (an sh env prefix; an argument of env, sudo,
    # cross-env, docker -e; a bare, export, declare or cmd set statement) or PowerShell $env:NAME=value / $env:NAME = value
    # (the placeholder of $env:NAME carries NAME as its hint; the rest of the statement is the value) -- or None
    raw = argv[i] if 0 <= i < len(argv) else None
    if raw is None:
        return None
    t = _strip_leading_openers(raw)
    plain = re.fullmatch(r'([A-Za-z_][A-Za-z0-9_]*)=(.*)', t, re.S)
    if plain:
        return (plain.group(1), plain.group(2), i + 1)
    o, c = spec['dynamic_placeholder_open'], spec['dynamic_placeholder_close']
    if not t.startswith(o + ':'):
        return None
    end = t.find(c)
    if end < 0:
        return None
    # (any name: a segment of assignments only is a statement whatever else it assigns -- round 2, fail-closed)
    name = t[len(o) + 1:end]
    after = t[end + len(c):]
    if after.startswith('='):
        value = after[1:]
        return (name, value, i + 1) if value != '' else (name, ' '.join(argv[i + 1:]), len(argv))
    if after == '' and i + 1 < len(argv) and argv[i + 1].startswith('='):
        return (name, ' '.join([argv[i + 1][1:]] + list(argv[i + 2:])), len(argv))
    return None


def _dynamic_connection(a, spec):
    # U30G814 (G8-14): the assignment chooses the connection (case-insensitive: Windows reads its environment so) with a
    # value the text does not hold
    return a is not None and _contains_dynamic(spec, a[1]) and any(_ascii_lower(v) == _ascii_lower(a[0]) for v in spec['commands']['connection_env_variables'])


def _dynamic_connection_prefix(argv, k, spec):
    # U30G814 (G8-14): an env prefix of argv[k] -- an assignment among argv[0..k-1] -- chooses the connection dynamically
    before = list(argv[:k])
    return any(_dynamic_connection(_env_assignment_at(before, n, spec), spec) for n in range(len(before)))


def _sets_dynamic_connection(argv, spec):
    # U30G814 (G8-14): the segment runs no program and only assigns (after { / ( and an assignment word: export, declare -x,
    # cmd set ...), and one assignment chooses the connection dynamically: every later command of the text runs with it
    words = spec['commands']['env_assignment_words']
    i = 0
    while i < len(argv) and argv[i] in ('{', '('):
        i += 1
    head = _strip_leading_openers(argv[i]) if i < len(argv) else None
    if head is not None and _ascii_lower(head) in words:
        i += 1
        while i < len(argv) and argv[i].startswith('-'):
            i += 1
    found = False
    while i < len(argv):
        a = _env_assignment_at(argv, i, spec)
        if a is None:
            return False
        if _dynamic_connection(a, spec):
            found = True
        i = a[2]
    return found


def _analyze_argv_at(argv, ctx, read_sql_file, depth, spec):
    targets, unresolved = [], []
    if depth > spec['sql']['max_nesting']:
        return [], [('COMMAND', 'command nesting deeper than the classifier reads')]
    # U30F5 (D-5): a DB tool (or a shell command) run by xargs / parallel / find -exec takes arguments from the runner's input
    runners = spec['commands']['argument_substituting_runners']
    runner_at = next((n for n, a in enumerate(argv) if _program_name(a, spec) in runners), -1)

    def substituted(k, what):
        if 0 <= runner_at < k:
            return [('COMMAND', f'{what} run by {_program_name(argv[runner_at], spec)} takes arguments from its input')]
        return []

    cmds = spec['commands']

    def non_literal(tool, program, rest, connection):
        # U30F9 default-deny (owner decision 2026-10-03): a DB-capable tool run with ANY value the text does not hold -- the
        # program, an argument, stdin or the stdin file -- is NON_LITERAL, whatever the other arguments say
        if not _write_capable(tool, rest, ctx, spec):
            return []
        if _contains_dynamic(spec, program) or any(_contains_dynamic(spec, a) for a in rest) \
                or (ctx['stdin'] is not None and _contains_dynamic(spec, ctx['stdin'])) \
                or (ctx['stdin_file'] is not None and _contains_dynamic(spec, ctx['stdin_file'])):
            return [('NON_LITERAL', f'{tool.lower()} runs with a value the text does not hold (default-deny: a non-literal program, argument, stdin or stdin file)')]
        if connection:
            return [('NON_LITERAL', f'{tool.lower()} connects where an environment assignment the text does not hold points it (G8-14: a connection variable before the tool)')]
        return []

    def connection_at(k):
        # U30G814 (G8-14): what argv[k] inherits -- the connection of the text so far, or an env prefix of its own
        return ctx['connection'] or _dynamic_connection_prefix(argv, k, spec)

    for k in range(len(argv)):
        wrapper = _shell_wrapper(argv[k], spec)
        if wrapper:
            flags, rest_of_line = wrapper
            at = next((n for n in range(k + 1, len(argv)) if _ascii_lower(argv[n]) in flags), -1)
            if at >= 0 and at + 1 < len(argv):
                pre = substituted(k, 'a shell command')
                command = ' '.join(_requote(a) for a in argv[at + 1:]) if rest_of_line else argv[at + 1]
                # U30F6 (F5-1): a shell running a command whose program is a value runs what the text does not hold
                if any(seg['argv'] and _dynamic_hint(spec, unwrap_grouping(seg['argv'][0])) is not None for pipeline in split_command_line(command, spec) for seg in pipeline):
                    pre = pre + [('COMMAND', 'a shell runs a command the text does not hold')]
                t, u = _analyze_command_at(command, read_sql_file, depth + 1, spec, None, None, connection_at(k))
                return targets + t, unresolved + pre + u
            # U30F8 (G6-1): a shell fed a here-document / here-string runs it as its script when it names none
            if ctx['stdin'] is not None:
                if not any(not a.startswith('-') for a in argv[k + 1:]):
                    t, u = _analyze_command_at(ctx['stdin'], read_sql_file, depth + 1, spec, None, None, connection_at(k))
                    return targets + t, unresolved + u
                if _contains_dynamic(spec, ctx['stdin']):
                    unresolved.append(('COMMAND', 'a script reads a here-document with values the text does not hold'))
                return targets, unresolved
            continue
        # U30F9 (G8-5): a remote shell (ssh) runs the words after its destination as a command line on the other host -- with
        # this segment's stdin -- or, without a command, its stdin as the remote shell's script
        remote = cmds['remote_shells'].get(_program_name(argv[k], spec))
        if remote:
            n = k + 1
            while n < len(argv) and argv[n].startswith('-') and argv[n] != '--':
                if argv[n] in remote['value_flags']:
                    n += 1
                n += 1
            if _at_list(argv, n) == '--':
                n += 1
            words = argv[n + 1:]
            if words:
                pre = substituted(k, 'a remote command')
                # (the words are re-quoted: psql -c "TRUNCATE env.sgu_well" stays one -c value on the other host too)
                t, u = _analyze_command_at(' '.join(_requote(a) for a in words), read_sql_file, depth + 1, spec, ctx['stdin'], ctx['stdin_file'], connection_at(k))
                return targets + t, unresolved + pre + u
            if ctx['stdin'] is not None:
                t, u = _analyze_command_at(ctx['stdin'], read_sql_file, depth + 1, spec, None, None, connection_at(k))
                return targets + t, unresolved + u
            if ctx['stdin_file'] is not None:
                unresolved.append(('COMMAND', 'a remote shell reads its script from a file the text does not hold'))
            return targets, unresolved
        tool = tool_of(argv[k], spec)
        if tool:
            pre = substituted(k, tool.lower()) + non_literal(tool, argv[k], argv[k + 1:], connection_at(k))
            t, u = _analyze_tool(tool, argv[k + 1:], ctx, read_sql_file, depth, spec)
            return targets + t, unresolved + pre + u
        name = _program_name(argv[k], spec)
        # U30F9 (G8-12): a code runner of a language no binding reads (ruby, perl, php) given code -- an option, a script file
        # (a path or a name with an extension), stdin or a stdin file -- runs code the classifier cannot read
        if name in cmds['unread_code_runners']:
            def _unread_given(a):
                u = re.sub(r'[ \t\r\n]+\Z', '', unwrap_grouping(a))
                return u.startswith('-') or re.search(r'[\\/]', u) or re.search(r'\.[A-Za-z0-9]+\Z', u) or _contains_dynamic(spec, u)
            given = any(_unread_given(a) for a in argv[k + 1:])
            if given or ctx['stdin'] is not None or ctx['stdin_file'] is not None:
                unresolved.append(('COMMAND', f'{name} runs code the classifier does not read'))
                return targets, unresolved
        # U30F8 (G6-1/G6-7): code from a flag value (node -e, python -c) or from an expanded here-document / here-string
        code_flags = cmds['code_runners'].get(name)
        if code_flags:
            for n in range(k + 1, len(argv)):
                lower = _ascii_lower(argv[n])
                flag = next((f for f in code_flags if lower == f or lower.startswith(f + '=')), None)
                if flag is None:
                    continue
                code = (argv[n + 1] if n + 1 < len(argv) else None) if lower == flag else argv[n][len(flag) + 1:]
                if code is not None and _contains_dynamic(spec, code):
                    unresolved.append(('COMMAND', f'{name} evaluates code the text does not hold'))
                break
            if ctx['stdin'] is not None and _contains_dynamic(spec, ctx['stdin']):
                unresolved.append(('COMMAND', f'{name} reads a here-document with values the text does not hold'))
            continue
        if name in cmds['eval_words'] and any(_contains_dynamic(spec, a) for a in argv[k + 1:]):
            unresolved.append(('COMMAND', f'{name} evaluates code the text does not hold'))
    flag_set = set(_ascii_lower(a.strip()) for a in argv)
    o = spec['ogr2ogr']
    if any(f in flag_set for f in o['layer_name_flags']) or any(f in flag_set for f in o['sql_flags']) or any(_is_pg_datasource(a, spec) for a in argv):
        pre = non_literal('OGR2OGR', argv[0] if argv else '', argv[1:], ctx['connection'])
        t, u, _ = analyze_ogr2ogr_args(argv[1:], spec)
        return targets + t, unresolved + pre + u
    for n, a in enumerate(argv):
        if re.search(r'\s', a) and any(name in _ascii_lower(a) for name in spec['commands']['tools'].keys()):
            t, u = _analyze_command_at(a, read_sql_file, depth + 1, spec, None, None, connection_at(n))
            targets += t
            unresolved += u
    return targets, unresolved


def _at_list(items, n):
    return items[n] if 0 <= n < len(items) else None


def _analyze_command_at(command, read_sql_file, depth, spec, inherited_stdin=None, inherited_stdin_file=None, inherited_connection=False):
    # inherited_stdin / inherited_stdin_file (U30F9, G8-5): what a remote shell (ssh) hands its remote command -- the first
    # segment of the first pipeline reads them when the command names no stdin of its own
    targets, unresolved = [], []
    first = True
    # U30G814 (G8-14): a connection chosen by a value the text does not hold -- inherited, or set by an assignment statement
    # earlier in the text (export PGHOST="$H"; psql ..., PowerShell $env:PGDATABASE = $db; psql ...) -- holds for the rest
    connection = inherited_connection
    for pipeline in split_command_line(command, spec):
        tools = []
        for seg in pipeline:
            found = None
            for a in seg['argv']:
                found = tool_of(a, spec)
                if found:
                    break
            tools.append(found)
        for n, seg in enumerate(pipeline):
            # U30F8 (G6-7): in a command line the shell expands the program: one that is a value runs what the text does not hold
            prefix = spec['commands']['program_prefix_words']
            p = next((m for m, a in enumerate(seg['argv']) if not re.match(r'[A-Za-z_][A-Za-z0-9_]*=', a) and _ascii_lower(a) not in prefix), -1)
            if p >= 0 and _dynamic_hint(spec, unwrap_grouping(seg['argv'][p])) is not None and not tool_of(seg['argv'][p], spec):
                unresolved.append(('COMMAND', 'the program is a value the text does not hold'))
            inherits = first and n == 0 and seg['stdin'] is None and seg['stdin_file'] is None
            ctx = {'stdin': inherited_stdin if inherits else seg['stdin'], 'stdin_file': inherited_stdin_file if inherits else seg['stdin_file'],
                   'piped_from': tools[n - 1] if n > 0 else None, 'pipes_to': tools[n + 1] if n + 1 < len(tools) else None,
                   'connection': connection}
            t, u = _analyze_argv_at(seg['argv'], ctx, read_sql_file, depth, spec)
            targets += t
            unresolved += u
            if _sets_dynamic_connection(seg['argv'], spec):
                connection = True
        first = False
    return targets, unresolved


def analyze_command_line(command, read_sql_file=None, spec=None):
    return _analyze_command_at(command, read_sql_file, 0, spec or load_spec())


def analyze_command_argv(argv, read_sql_file=None, spec=None):
    spec = spec or load_spec()
    return _analyze_argv_at(list(argv), {'stdin': None, 'stdin_file': None, 'piped_from': None, 'pipes_to': None, 'connection': False}, read_sql_file, 0, spec)


# ------------------------------------------------------------------------------------------------
# Judgement
# ------------------------------------------------------------------------------------------------

def _target_text(target):
    op, scope, name = target
    if scope == 'SCHEMA':
        return 'schema:' + canonical_relation_text((None, name[1]))
    return canonical_relation_text(name)


def judge_writes(targets, unresolved, definition=None):
    d = definition or load_definition()
    protected = []
    open_ = list(unresolved)
    for t in targets:
        op, scope, name = t
        c = classify_schema(canonical_relation_text((None, name[1])), d) if scope == 'SCHEMA' else classify_relation(name, d)
        if c['kind'] == 'PROTECTED':
            protected.append((op, _target_text(t), c['class']))
        elif c['kind'] == 'UNRESOLVABLE':
            open_.append((op, 'not a relation name'))
    verdict = 'PROTECTED' if protected else 'UNRESOLVABLE' if open_ else 'ALLOWED'
    return {'verdict': verdict, 'protected': protected, 'unresolved': open_}


def normalized_verdict(judged):
    return {
        'verdict': judged['verdict'],
        'protected': sorted(set(f'{op} {rel}' for op, rel, _ in judged['protected'])),
        'unresolved': sorted(set(op for op, _ in judged['unresolved'])),
    }


def classify_protected_write(case, definition=None):
    """The normalized verdict for one parity-corpus input (files are never read: psql -f is unresolved)."""
    kind = case['kind']
    if kind == 'sql':
        return normalized_verdict(judge_writes(*analyze_sql(case['text']), definition=definition))
    if kind == 'ogr2ogr':
        t, u, _ = analyze_ogr2ogr_args(case['args'])
        return normalized_verdict(judge_writes(t, u, definition))
    if kind == 'argv':
        return normalized_verdict(judge_writes(*analyze_command_argv(case['args']), definition=definition))
    if kind == 'command':
        return normalized_verdict(judge_writes(*analyze_command_line(case['text']), definition=definition))
    schema_level = kind == 'schema' or (kind == 'operation' and is_schema_operation(case['operation']))
    c = classify_schema(case['text'], definition) if schema_level else classify_relation(case['text'], definition)
    op = case['operation'] if kind == 'operation' else kind.upper()
    if c['kind'] == 'PROTECTED':
        return {'verdict': 'PROTECTED', 'protected': [f"{op} {c['relation']}"], 'unresolved': []}
    if c['kind'] == 'UNRESOLVABLE':
        return {'verdict': 'UNRESOLVABLE', 'protected': [], 'unresolved': [op]}
    return {'verdict': 'ALLOWED', 'protected': [], 'unresolved': []}


# ------------------------------------------------------------------------------------------------
# The gate
# ------------------------------------------------------------------------------------------------

_DOORS = 'only the governed import path (import-librarian-manifest) may change it. There is no override.'


def _refuse(caller, judged, what):
    if judged['protected']:
        op, rel, cls = judged['protected'][0]
        raise ProtectedRelationGateError(REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION, caller, op, rel, f'{cls}: {_DOORS}')
    if judged['unresolved']:
        op, reason = judged['unresolved'][0]
        raise ProtectedRelationGateError(REJECT_DESTRUCTIVE_WRITE_TARGET_UNRESOLVABLE, caller, op, '(unresolved)',
                                         f'{reason}; {what}: a target that is not static cannot be shown not to be protected')


def _definition_or_refuse(caller, operation, relation):
    try:
        return load_definition(), load_spec()
    except Exception as error:  # an unreadable definition refuses, never allows
        raise ProtectedRelationGateError(REJECT_DESTRUCTIVE_WRITE_TARGET_UNRESOLVABLE, caller, operation, relation,
                                         f'the protected relation definition could not be read: {error}')


def assert_ungoverned_write_allowed(caller, operation, relation):
    """Refuse a destructive write by an ungoverned path to a protected (or unresolvable) relation or schema."""
    d, spec = _definition_or_refuse(caller, operation, relation)
    c = classify_schema(relation, d) if is_schema_operation(operation, spec) else classify_relation(relation, d, spec)
    if c['kind'] == 'UNPROTECTED':
        return
    if c['kind'] == 'UNRESOLVABLE':
        raise ProtectedRelationGateError(REJECT_DESTRUCTIVE_WRITE_TARGET_UNRESOLVABLE, caller, operation, relation,
                                         'not a relation name; a target that cannot be resolved cannot be shown not to be protected')
    raise ProtectedRelationGateError(REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION, caller, operation, c['relation'], f"{c['class']}: {_DOORS}")


def gated_sql(caller, sql):
    """Refuse SQL that writes a protected or non-static target; return it unchanged otherwise."""
    d, spec = _definition_or_refuse(caller, 'SQL', '(sql)')
    _refuse(caller, judge_writes(*analyze_sql(sql, spec), definition=d), 'SQL ' + ' '.join(sql.split())[:160])
    return sql


def assert_ogr2ogr_write_allowed(caller, args):
    """Refuse an ogr2ogr argument vector (without the program) that writes a protected or non-static target."""
    d, spec = _definition_or_refuse(caller, 'OGR2OGR_WRITE', '(args)')
    t, u, _ = analyze_ogr2ogr_args([str(a) for a in args], spec)
    _refuse(caller, judge_writes(t, u, d), 'ogr2ogr ' + ' '.join(str(a) for a in args)[:160])
    return args


def _read_sql_file(path):
    try:
        return pathlib.Path(path).read_text(encoding='utf-8') if os.path.isfile(path) else None
    except OSError:
        return None


def assert_command_write_allowed(caller, command=None, argv=None):
    """Refuse a command line or argv (program first) that writes a protected or non-static target; return it."""
    d, spec = _definition_or_refuse(caller, 'COMMAND', '(command)')
    if argv is not None:
        t, u = analyze_command_argv([str(a) for a in argv], _read_sql_file, spec)
        shown = ' '.join(str(a) for a in argv)
    else:
        t, u = analyze_command_line(command or '', _read_sql_file, spec)
        shown = command or ''
    _refuse(caller, judge_writes(t, u, d), 'command ' + shown[:160])
    return argv if argv is not None else command


if __name__ == '__main__':
    if len(sys.argv) >= 2 and sys.argv[1] == '--classify':
        print(json.dumps([dict(classify_relation(name), input=name) for name in sys.argv[2:]]))
        sys.exit(0)
    if len(sys.argv) == 3 and sys.argv[1] == '--corpus':
        cases = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
        out = []
        for case in cases:
            try:
                out.append({'id': case['id'], **classify_protected_write(case)})
            except Exception as error:  # reported, never "allowed"
                out.append({'id': case['id'], 'verdict': 'ERROR', 'protected': [], 'unresolved': [], 'error': str(error)})
        sys.stdout.write(json.dumps(out, ensure_ascii=True))
        sys.exit(0)
    print('usage: protected_relation_gate.py --classify <relation> ... | --corpus <cases.json>', file=sys.stderr)
    sys.exit(2)
