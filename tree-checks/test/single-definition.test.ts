// Spec 00 §2.4 check 3: no type, schema, bound, header name, error code or
// routing entry from §3 or §4 is declared outside packages/contracts.
import * as contracts from '@demo/contracts';
import { describe, expect, it } from 'vitest';
import {
  collectContractTokens,
  findRedeclarations,
  isSingleDefinitionScanned,
} from '../src/single-definition';

const contractTokens = collectContractTokens(contracts);

function rulesFound(sourceText: string): string[] {
  return findRedeclarations('packages/test-doubles/src/planted.ts', sourceText, contractTokens).map(
    (finding) => finding.rule,
  );
}

describe('the scanned files', () => {
  it('are non test sources outside packages/contracts', () => {
    expect(isSingleDefinitionScanned('packages/test-doubles/src/index.ts')).toBe(true);
    expect(isSingleDefinitionScanned('packages/construct-contracts/src/stub-constructs.ts')).toBe(
      true,
    );
    expect(isSingleDefinitionScanned('infra/lib/demo-platform.ts')).toBe(true);
    expect(isSingleDefinitionScanned('services/read/src/read-handler.ts')).toBe(true);
    expect(isSingleDefinitionScanned('packages/contracts/src/headers.ts')).toBe(false);
    expect(isSingleDefinitionScanned('packages/test-doubles/test/anything.test.ts')).toBe(false);
    expect(isSingleDefinitionScanned('README.md')).toBe(false);
  });
});

describe('findRedeclarations', () => {
  it.each([
    ['a header name', "const correlationHeader = 'X-Correlation-Id';", 'header-name'],
    ['a header name in another case', "headers['idempotency-key'] = key;", 'header-name'],
    ['a §3.3 bound', 'const maximumBodyBytes = 65_536;', 'bound'],
    ['a §3.3 bound written plainly', 'if (length > 262144) {}', 'bound'],
    ['a route path', "const commandsPath = '/v1/commands';", 'routing-entry'],
    ['the problem type prefix', "const prefix = 'https://errors.demo.local/';", 'routing-entry'],
    [
      'a contract declaration name',
      'export interface CommandRequest { recordId: string }',
      'declaration-name',
    ],
    ['a contract schema name', 'const ProblemDocumentSchema = undefined;', 'declaration-name'],
    [
      'a parallel list of error codes',
      "const codes = ['not-found', 'forbidden'];",
      'parallel-list',
    ],
    ['a parallel list of sections', "z.enum(['summary', 'tasks', 'notes'])", 'parallel-list'],
    [
      'a parallel list of providers',
      "const providers = ['provider-a', 'provider-b'];",
      'parallel-list',
    ],
  ])('finds %s', (_caseName, sourceText, expectedRule) => {
    expect(rulesFound(sourceText)).toEqual([expectedRule]);
  });

  it.each([
    ['a contract value used through its type', "if (section === 'notes') {}"],
    ['a single contract value in a list', "const sections = ['notes'];"],
    ['a small number that happens to equal a bound', 'const memorySize = 256;'],
    ['an import of a contract name', "import { CommandRequest } from '@demo/contracts';"],
    ['an unrelated header', "const header = 'X-Request-Id';"],
  ])('allows %s', (_caseName, sourceText) => {
    expect(rulesFound(sourceText)).toEqual([]);
  });

  // Datum 0.7 permits a deliberate duplication when a comment says why.
  it('allows a duplication marked, with its reason, on the same or the previous line', () => {
    expect(
      rulesFound("// single-definition: AWS names this header\nconst header = 'Content-Type';"),
    ).toEqual([]);
    expect(
      rulesFound("const header = 'Content-Type'; // single-definition: AWS names this header"),
    ).toEqual([]);
    expect(rulesFound("// single-definition:\nconst header = 'Content-Type';")).toEqual([
      'header-name',
    ]);
  });

  it('reports the line of each finding', () => {
    const findings = findRedeclarations(
      'infra/lib/planted.ts',
      "const fine = 1;\nconst header = 'ETag';",
      contractTokens,
    );
    expect(findings).toEqual([
      { filePath: 'infra/lib/planted.ts', line: 2, rule: 'header-name', detail: 'ETag' },
    ]);
  });
});
