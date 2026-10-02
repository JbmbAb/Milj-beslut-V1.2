"""
protected_relation_gate.py -- U30F F1 (PRES-05): the Python binding of the protected relation gate.

The definition is the same file the TypeScript gate reads
(packages/spatial-provider-postgis/src/protected-relations.v1.json); the classification below is a
line-for-line port of ProtectedRelations.ts and is held to it by the inventory test
(tests/unit/protectedRelationGateInventory.test.ts runs `--classify` and compares).

A Python importer calls `assert_ungoverned_write_allowed(caller, operation, relation)` before every
destructive statement or ogr2ogr write. A protected (or unresolvable) relation raises
ProtectedRelationGateError; there is no override, no environment switch and no force flag. A
missing or malformed definition refuses every call (fail-closed).

This module has no side effects on import and never touches a database.
"""
import json
import pathlib
import re
import sys

PROTECTED_RELATIONS_CONTRACT_V1 = 'mimer-protected-relations-v1'
PROTECTED_RELATIONS_FILE = (
    pathlib.Path(__file__).resolve().parents[2] / 'packages' / 'spatial-provider-postgis' / 'src' / 'protected-relations.v1.json'
)
REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION = 'REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION'
REJECT_DESTRUCTIVE_WRITE_TARGET_UNRESOLVABLE = 'REJECT_DESTRUCTIVE_WRITE_TARGET_UNRESOLVABLE'
_PLAIN = re.compile(r'^[a-z_][a-z0-9_]*$')
_NAME_PART = re.compile(r'\s*(?:"((?:[^"]|"")+)"|([A-Za-z_][A-Za-z0-9_$]*))\s*')


class ProtectedRelationGateError(RuntimeError):
    def __init__(self, code, caller, operation, relation, detail):
        super().__init__(f'{code}: {caller} may not {operation} {relation}: {detail}')
        self.code = code
        self.caller = caller
        self.operation = operation
        self.relation = relation


def load_definition(path=PROTECTED_RELATIONS_FILE):
    """The validated definition; any defect raises (and so refuses every write)."""
    data = json.loads(pathlib.Path(path).read_text(encoding='utf-8'))
    if data.get('contract') != PROTECTED_RELATIONS_CONTRACT_V1:
        raise RuntimeError('PROTECTED_RELATIONS_DEFINITION_INVALID: contract')
    schemas = data.get('retained_staging_schemas')
    relations = data.get('relations')
    if not schemas or not all(isinstance(s, str) and _PLAIN.match(s) for s in schemas):
        raise RuntimeError('PROTECTED_RELATIONS_DEFINITION_INVALID: retained_staging_schemas')
    if not relations:
        raise RuntimeError('PROTECTED_RELATIONS_DEFINITION_INVALID: relations')
    entries = []
    for r in relations:
        parts = str(r.get('relation', '')).split('.')
        if len(parts) != 2 or not all(_PLAIN.match(p) for p in parts) or r.get('class') not in ('LU_LIVE_LAYER', 'LU_DERIVED'):
            raise RuntimeError(f'PROTECTED_RELATIONS_DEFINITION_INVALID: {r!r}')
        entries.append({'relation': r['relation'], 'schema': parts[0], 'table': parts[1], 'class': r['class']})
    return {'retained_staging_schemas': list(schemas), 'relations': entries}


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


def _partition_of(entry, table):
    prefix = entry['table'] + '_'
    return table.startswith(prefix) and re.match(r'^(g\d+|default)$', table[len(prefix):]) is not None


def _retained_shape_of(entry, table):
    prefix = entry['table'] + '_'
    return table.startswith(prefix) and re.match(r'^[0-9a-f]{8}$', table[len(prefix):]) is not None


def classify_relation(raw, definition=None):
    """{'kind': PROTECTED|UNPROTECTED|UNRESOLVABLE, 'relation': ..., 'class': ...}"""
    d = definition or load_definition()
    parsed = parse_relation_name(raw)
    if parsed is None:
        return {'kind': 'UNRESOLVABLE', 'relation': str(raw).strip()}
    schema, table = parsed
    relation = table if schema is None else f'{schema}.{table}'
    if schema is not None:
        if schema in d['retained_staging_schemas']:
            return {'kind': 'PROTECTED', 'relation': relation, 'class': 'RETAINED_STAGING'}
        for e in d['relations']:
            if e['schema'] == schema and (e['table'] == table or _partition_of(e, table)):
                return {'kind': 'PROTECTED', 'relation': relation, 'class': e['class']}
        return {'kind': 'UNPROTECTED', 'relation': relation}
    for e in d['relations']:
        if e['table'] == table or _partition_of(e, table):
            return {'kind': 'PROTECTED', 'relation': relation, 'class': e['class']}
        if _retained_shape_of(e, table):
            return {'kind': 'PROTECTED', 'relation': relation, 'class': 'RETAINED_STAGING'}
    return {'kind': 'UNPROTECTED', 'relation': relation}


def assert_ungoverned_write_allowed(caller, operation, relation):
    """Refuse a destructive write by an ungoverned path to a protected (or unresolvable) relation."""
    try:
        c = classify_relation(relation)
    except Exception as error:  # an unreadable definition refuses, never allows
        raise ProtectedRelationGateError(REJECT_DESTRUCTIVE_WRITE_TARGET_UNRESOLVABLE, caller, operation, relation,
                                         f'the protected relation definition could not be read: {error}')
    if c['kind'] == 'UNPROTECTED':
        return
    if c['kind'] == 'UNRESOLVABLE':
        raise ProtectedRelationGateError(REJECT_DESTRUCTIVE_WRITE_TARGET_UNRESOLVABLE, caller, operation, relation,
                                         'not a relation name; a target that cannot be resolved cannot be shown not to be protected')
    raise ProtectedRelationGateError(
        REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION, caller, operation, c['relation'],
        f"{c['class']}: only the governed import path (import-librarian-manifest) may change it. There is no override.")


if __name__ == '__main__':
    # Used by the inventory test to hold this binding to the TypeScript classification.
    if len(sys.argv) >= 2 and sys.argv[1] == '--classify':
        print(json.dumps([dict(classify_relation(name), input=name) for name in sys.argv[2:]]))
        sys.exit(0)
    print('usage: protected_relation_gate.py --classify <relation> ...', file=sys.stderr)
    sys.exit(2)
