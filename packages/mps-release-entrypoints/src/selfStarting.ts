import path from 'node:path';
import ts from 'typescript';

/**
 * Self-starting source files, decided by AST analysis of the TOP-LEVEL statements of a file (TypeScript compiler API).
 *
 * A file is self-starting when it has at least one TOP-LEVEL EXECUTABLE FORM, i.e. a top-level statement that is not on
 * the closed list of inert statements below. The list is closed on purpose: everything that is not known to be inert is
 * executable, so a new syntax shape can only add files that demand classification, never hide one.
 *
 * INERT top-level statements (and nothing else):
 *   - import declarations and `import x = require(..)`;
 *   - export declarations and re-exports (`export { .. }`, `export * from ..`);
 *   - `export default <expr>` / `export = <expr>` only when the expression is inert;
 *   - interface, type alias and enum declarations (enum member initialisers must be inert), `declare` module blocks and
 *     namespaces whose statements are inert;
 *   - function declarations (also `export default async function`);
 *   - class declarations without decorators, without static blocks, and without a call in the heritage clause, a computed
 *     member name or a static property initialiser;
 *   - variable statements whose initialisers (and binding-pattern defaults) are inert expressions;
 *   - empty statements.
 *
 * INERT expressions: literals (incl. regular expressions, template literals without calls), identifiers, `this`,
 * `import.meta`, property and element reads, object/array literals of inert members, arrow and function expressions
 * (declared, not invoked), class expressions under the class rule, parentheses and type assertions around inert
 * operands, prefix/postfix unary operators except ++ and --, binary/conditional/comma combinations of inert operands
 * with a non-assignment operator.
 *
 * EVERYTHING ELSE is executable: any expression statement, any call, `new`, `await`, tagged template, `yield`,
 * assignment, ++/--, `delete`, import(), `export default <executable expression>`, and any if/for/while/try/switch/
 * block/labelled statement (over-approximation: blocks are not inspected). A syntax error in the file also counts as
 * executable. Over-approximation is the safe direction: such a file must be listed in entries or not_production.
 *
 * Limits: this reads one file at a time and never follows imports, so a process started by an imported module's side
 * effect is not seen; it is applied to the process files by construction (server/index.ts and server/workers/*).
 */

export interface SelfStartingVerdict {
  readonly selfStarting: boolean;
  /** The top-level executable forms found: what kind (a SyntaxKind or role name) and on which line. */
  readonly markers: ReadonlyArray<{ readonly name: string; readonly line: number }>;
}

type Found = { readonly node: ts.Node; readonly kind: string } | null;

const kindName = (node: ts.Node): string => ts.SyntaxKind[node.kind] ?? 'Unknown';
const exec = (node: ts.Node, kind: string): Found => ({ node, kind });

const ASSIGNMENT_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

/** The first executable sub-expression of `e`, or null when the expression is inert. */
function executableInExpression(e: ts.Expression | undefined): Found {
  if (e === undefined) return null;
  switch (e.kind) {
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
    case ts.SyntaxKind.NumericLiteral:
    case ts.SyntaxKind.BigIntLiteral:
    case ts.SyntaxKind.RegularExpressionLiteral:
    case ts.SyntaxKind.TrueKeyword:
    case ts.SyntaxKind.FalseKeyword:
    case ts.SyntaxKind.NullKeyword:
    case ts.SyntaxKind.ThisKeyword:
    case ts.SyntaxKind.Identifier:
    case ts.SyntaxKind.MetaProperty:
    case ts.SyntaxKind.ArrowFunction:
    case ts.SyntaxKind.FunctionExpression:
      return null;
    default:
  }
  if (ts.isTemplateExpression(e)) {
    for (const span of e.templateSpans) {
      const f = executableInExpression(span.expression);
      if (f) return f;
    }
    return null;
  }
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isTypeAssertionExpression(e) || ts.isSatisfiesExpression(e)) {
    return executableInExpression(e.expression);
  }
  if (ts.isPropertyAccessExpression(e)) return executableInExpression(e.expression);
  if (ts.isElementAccessExpression(e)) return executableInExpression(e.expression) ?? executableInExpression(e.argumentExpression);
  if (ts.isArrayLiteralExpression(e)) {
    for (const el of e.elements) {
      const f = executableInExpression(ts.isSpreadElement(el) ? el.expression : el);
      if (f) return f;
    }
    return null;
  }
  if (ts.isObjectLiteralExpression(e)) {
    for (const member of e.properties) {
      if (ts.isPropertyAssignment(member)) {
        const f = (ts.isComputedPropertyName(member.name) ? executableInExpression(member.name.expression) : null) ?? executableInExpression(member.initializer);
        if (f) return f;
      } else if (ts.isShorthandPropertyAssignment(member)) {
        if (member.objectAssignmentInitializer !== undefined) return exec(member, 'shorthand-initializer');
      } else if (ts.isSpreadAssignment(member)) {
        const f = executableInExpression(member.expression);
        if (f) return f;
      } else if (ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
        if (ts.isComputedPropertyName(member.name)) {
          const f = executableInExpression(member.name.expression);
          if (f) return f;
        }
      } else return exec(member, kindName(member));
    }
    return null;
  }
  if (ts.isClassExpression(e)) return executableInClass(e);
  if (ts.isPrefixUnaryExpression(e)) {
    if (e.operator === ts.SyntaxKind.PlusPlusToken || e.operator === ts.SyntaxKind.MinusMinusToken) return exec(e, 'update');
    return executableInExpression(e.operand);
  }
  if (ts.isPostfixUnaryExpression(e)) return exec(e, 'update');
  if (ts.isTypeOfExpression(e) || ts.isVoidExpression(e)) return executableInExpression(e.expression);
  if (ts.isBinaryExpression(e)) {
    if (ASSIGNMENT_OPERATORS.has(e.operatorToken.kind)) return exec(e, 'assignment');
    return executableInExpression(e.left) ?? executableInExpression(e.right);
  }
  if (ts.isConditionalExpression(e)) return executableInExpression(e.condition) ?? executableInExpression(e.whenTrue) ?? executableInExpression(e.whenFalse);
  if (ts.isCallExpression(e)) return exec(e, 'call');
  if (ts.isNewExpression(e)) return exec(e, 'new');
  if (ts.isAwaitExpression(e)) return exec(e, 'await');
  if (ts.isTaggedTemplateExpression(e)) return exec(e, 'tagged-template');
  if (ts.isYieldExpression(e)) return exec(e, 'yield');
  if (ts.isDeleteExpression(e)) return exec(e, 'delete');
  return exec(e, kindName(e)); // a shape this analysis does not know: executable
}

function executableInClass(cls: ts.ClassLikeDeclaration): Found {
  if (ts.canHaveDecorators(cls) && (ts.getDecorators(cls)?.length ?? 0) > 0) return exec(cls, 'decorator');
  for (const clause of cls.heritageClauses ?? []) {
    for (const type of clause.types) {
      const f = executableInExpression(type.expression);
      if (f) return f;
    }
  }
  for (const member of cls.members) {
    if (ts.isClassStaticBlockDeclaration(member)) return exec(member, 'static-block');
    if (ts.canHaveDecorators(member) && (ts.getDecorators(member)?.length ?? 0) > 0) return exec(member, 'decorator');
    if (member.name !== undefined && ts.isComputedPropertyName(member.name)) {
      const f = executableInExpression(member.name.expression);
      if (f) return f;
    }
    if (ts.isPropertyDeclaration(member) && member.initializer !== undefined && (ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static) !== 0) {
      const f = executableInExpression(member.initializer);
      if (f) return f;
    }
  }
  return null;
}

function executableInBinding(name: ts.BindingName): Found {
  if (ts.isIdentifier(name)) return null;
  for (const el of name.elements) {
    if (ts.isOmittedExpression(el)) continue;
    const key = el.propertyName;
    const f = (key !== undefined && ts.isComputedPropertyName(key) ? executableInExpression(key.expression) : null) ?? executableInExpression(el.initializer) ?? executableInBinding(el.name);
    if (f) return f;
  }
  return null;
}

function executableInStatement(s: ts.Statement): Found {
  if (ts.isImportDeclaration(s) || ts.isImportEqualsDeclaration(s) || ts.isExportDeclaration(s)) return null;
  if (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isFunctionDeclaration(s) || ts.isEmptyStatement(s)) return null;
  if (ts.isEnumDeclaration(s)) {
    for (const m of s.members) {
      const f = executableInExpression(m.initializer);
      if (f) return f;
    }
    return null;
  }
  if (ts.isModuleDeclaration(s)) {
    if (s.body === undefined || !ts.isModuleBlock(s.body)) return null;
    for (const inner of s.body.statements) {
      const f = executableInStatement(inner);
      if (f) return f;
    }
    return null;
  }
  if (ts.isExportAssignment(s)) {
    const f = executableInExpression(s.expression);
    return f ? exec(s, `export-default-${f.kind}`) : null;
  }
  if (ts.isClassDeclaration(s)) return executableInClass(s);
  if (ts.isVariableStatement(s)) {
    for (const d of s.declarationList.declarations) {
      const f = executableInExpression(d.initializer) ?? executableInBinding(d.name);
      if (f) return f;
    }
    return null;
  }
  if (ts.isExpressionStatement(s)) return exec(s, 'expression-statement');
  return exec(s, kindName(s)); // if / for / while / try / switch / block / labelled / ...: executable
}

export function detectSelfStarting(text: string, fileName = 'file.ts'): SelfStartingVerdict {
  const ext = path.posix.extname(fileName);
  const kind = ext === '.tsx' ? ts.ScriptKind.TSX : ext === '.js' || ext === '.mjs' || ext === '.cjs' ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const markers: Array<{ name: string; line: number }> = [];
  const diagnostics = (sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? [];
  if (diagnostics.length > 0) markers.push({ name: 'syntax-error', line: 1 });
  for (const statement of sf.statements) {
    const found = executableInStatement(statement);
    if (found !== null) markers.push({ name: found.kind, line: sf.getLineAndCharacterOfPosition(found.node.getStart(sf)).line + 1 });
  }
  return { selfStarting: markers.length > 0, markers };
}

/**
 * Files under server/workers/ that are libraries (imported by process files, never started themselves). The AST
 * detector must find NO top-level executable form in each one; a library that gains one fails the consistency check.
 */
export const LIBRARY_FILES: Readonly<Record<string, string>> = {
  'server/workers/bootstrap.ts':
    'exports bootstrapWorkerProcess and the assertLuWorker* start-up checks; only functions, nothing runs when it is imported. Imported by every worker process file.',
  'server/workers/registry.ts':
    'exports shouldStartWorkersInProcess and startInProcessWorkers (the in-process worker registry used by server/index.ts); only functions and constants, nothing runs when it is imported.',
};
