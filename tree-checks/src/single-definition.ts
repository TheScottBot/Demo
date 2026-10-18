import ts from 'typescript';

// Spec 00 §2.4 check 3: no type, schema, bound, header name, error code or
// routing entry from §3 or §4 is declared outside packages/contracts. The
// mechanism, a Plan stage choice, is this: the tokens are collected from the
// contract package itself, then every other non test source is parsed and
// searched for a redeclaration of one.
//
// A contract value used through its type (`section === 'notes'`) is not a
// redeclaration: the compiler holds it to the contract. A list of several
// values from one contract vocabulary is: it is a second copy of the list.

export type RedeclarationRule =
  'header-name' | 'bound' | 'routing-entry' | 'declaration-name' | 'parallel-list';

export interface RedeclarationFinding {
  readonly filePath: string;
  readonly line: number;
  readonly rule: RedeclarationRule;
  readonly detail: string;
}

export interface ContractTokens {
  readonly headerNames: ReadonlySet<string>;
  readonly bounds: ReadonlySet<number>;
  readonly routingStrings: ReadonlySet<string>;
  readonly declarationNames: ReadonlySet<string>;
  readonly vocabularies: readonly ReadonlySet<string>[];
}

// Small bounds (64, 128, 256) are ordinary numbers too, so only the
// distinctive ones are searched for; the rest are left to review.
const minimumDistinctiveBound = 1_000;

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate);
}

function isStringList(candidate: unknown): candidate is string[] {
  return Array.isArray(candidate) && candidate.every((element) => typeof element === 'string');
}

function stringList(candidate: unknown): string[] | undefined {
  return isStringList(candidate) ? candidate : undefined;
}

// Every exported name of the contract package, from its sources, so types and
// interfaces count as well as runtime values.
export function exportedNamesInSource(sourceText: string): string[] {
  const sourceFile = ts.createSourceFile('contract.ts', sourceText, ts.ScriptTarget.Latest, true);
  const exportedNames: string[] = [];
  for (const statement of sourceFile.statements) {
    const isExported = ts
      .getModifiers(statement as ts.HasModifiers)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (isExported !== true) {
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          exportedNames.push(declaration.name.text);
        }
      }
    } else if (
      (ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isFunctionDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name !== undefined
    ) {
      exportedNames.push(statement.name.text);
    }
  }
  return exportedNames;
}

export function collectContractTokens(
  contractsModule: Readonly<Record<string, unknown>>,
  contractSourceTexts: readonly string[] = [],
): ContractTokens {
  const headerNames = new Set<string>();
  if (isRecord(contractsModule['httpHeaders'])) {
    for (const headerDefinition of Object.values(contractsModule['httpHeaders'])) {
      if (isRecord(headerDefinition) && typeof headerDefinition['wireName'] === 'string') {
        headerNames.add(headerDefinition['wireName'].toLowerCase());
      }
    }
  }
  const bounds = new Set<number>();
  if (isRecord(contractsModule['contractBounds'])) {
    for (const boundValue of Object.values(contractsModule['contractBounds'])) {
      if (typeof boundValue === 'number' && boundValue >= minimumDistinctiveBound) {
        bounds.add(boundValue);
      }
    }
  }
  const routingStrings = new Set<string>();
  if (typeof contractsModule['problemTypeUriPrefix'] === 'string') {
    routingStrings.add(contractsModule['problemTypeUriPrefix']);
  }
  if (Array.isArray(contractsModule['publicRoutes'])) {
    for (const publicRoute of contractsModule['publicRoutes'] as unknown[]) {
      if (isRecord(publicRoute) && typeof publicRoute['path'] === 'string') {
        routingStrings.add(publicRoute['path']);
      }
    }
  }
  const declarationNames = new Set<string>(Object.keys(contractsModule));
  for (const exportedName of Object.keys(contractsModule)) {
    // A schema's inferred type shares its name, less the suffix.
    if (exportedName.endsWith('Schema')) {
      declarationNames.add(exportedName.slice(0, -'Schema'.length));
    }
  }
  for (const contractSourceText of contractSourceTexts) {
    for (const exportedName of exportedNamesInSource(contractSourceText)) {
      declarationNames.add(exportedName);
    }
  }
  const vocabularies: Set<string>[] = [];
  for (const exportedValue of Object.values(contractsModule)) {
    const enumOptions = isRecord(exportedValue) ? stringList(exportedValue['options']) : undefined;
    const valueList = enumOptions ?? stringList(exportedValue);
    const objectValues =
      isRecord(exportedValue) &&
      Object.values(exportedValue).every((value) => typeof value === 'string')
        ? (Object.values(exportedValue) as string[])
        : undefined;
    const vocabulary = valueList ?? objectValues;
    if (vocabulary !== undefined && vocabulary.length >= 2) {
      vocabularies.push(new Set(vocabulary));
    }
  }
  return { headerNames, bounds, routingStrings, declarationNames, vocabularies };
}

export function isSingleDefinitionScanned(filePath: string): boolean {
  if (!filePath.endsWith('.ts') || filePath.endsWith('.test.ts') || filePath.includes('/test/')) {
    return false;
  }
  if (filePath.startsWith('packages/contracts/')) {
    return false;
  }
  return (
    /^packages\/[^/]+\/src\//.test(filePath) ||
    /^services\/[^/]+\//.test(filePath) ||
    filePath.startsWith('infra/bin/') ||
    filePath.startsWith('infra/lib/')
  );
}

// Datum 0.7 permits a deliberate duplication when a comment says why. The
// marker must carry a reason, on the line itself or the line above.
const exemptionMarker = /single-definition:\s*\S/;

function isExempt(lines: readonly string[], lineNumber: number): boolean {
  return [lines[lineNumber - 1], lines[lineNumber - 2]].some(
    (lineText) => lineText !== undefined && exemptionMarker.test(lineText),
  );
}

const declarationKinds = new Set([
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.VariableDeclaration,
]);

export function findRedeclarations(
  filePath: string,
  sourceText: string,
  contractTokens: ContractTokens,
): RedeclarationFinding[] {
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
  const lines = sourceText.split('\n');
  const findings: RedeclarationFinding[] = [];
  const report = (node: ts.Node, rule: RedeclarationRule, detail: string) => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    if (!isExempt(lines, line)) {
      findings.push({ filePath, line, rule, detail });
    }
  };
  const visit = (node: ts.Node): void => {
    // Module specifiers name packages, not contract values.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (contractTokens.headerNames.has(node.text.toLowerCase())) {
        report(node, 'header-name', node.text);
      } else if (contractTokens.routingStrings.has(node.text)) {
        report(node, 'routing-entry', node.text);
      }
    } else if (ts.isNumericLiteral(node)) {
      const numericValue = Number(node.getText(sourceFile).replaceAll('_', ''));
      if (contractTokens.bounds.has(numericValue)) {
        report(node, 'bound', String(numericValue));
      }
    } else if (ts.isArrayLiteralExpression(node)) {
      const stringElements = node.elements
        .filter(ts.isStringLiteral)
        .map((element) => element.text);
      const matchingVocabulary = contractTokens.vocabularies.find(
        (vocabulary) =>
          stringElements.length >= 2 &&
          stringElements.length === node.elements.length &&
          stringElements.every((element) => vocabulary.has(element)),
      );
      if (matchingVocabulary !== undefined) {
        report(node, 'parallel-list', stringElements.join(', '));
        return;
      }
    }
    if (declarationKinds.has(node.kind)) {
      const declarationName = (node as ts.NamedDeclaration).name;
      if (
        declarationName !== undefined &&
        ts.isIdentifier(declarationName) &&
        contractTokens.declarationNames.has(declarationName.text)
      ) {
        report(declarationName, 'declaration-name', declarationName.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}
