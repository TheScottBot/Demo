// Datum 0.10, Spec 00 §2.4 check 2.
import { describe, expect, it } from 'vitest';
import { findForbiddenImports, isPureModulePath } from '../src/pure-imports';

describe('isPureModulePath', () => {
  it('names every file under a pure module directory, and nothing else', () => {
    expect(isPureModulePath('packages/contracts/src/bounds.ts')).toBe(true);
    expect(isPureModulePath('packages/contracts/src/nested/deeper.ts')).toBe(true);
    expect(isPureModulePath('packages/contracts/test/bounds.test.ts')).toBe(false);
    expect(isPureModulePath('packages/test-doubles/src/index.ts')).toBe(false);
    expect(isPureModulePath('packages/contracts-extra/src/index.ts')).toBe(false);
  });
});

// Added in Spec 02 RE1: Spec 02 §2 names pure files inside a directory that
// also holds impure ones, so files can be listed one by one.
describe('isPureModulePath for listed files', () => {
  it('names each listed pure file, and not its impure neighbours', () => {
    expect(isPureModulePath('services/read/src/aggregate-etag.ts')).toBe(true);
    expect(isPureModulePath('services/read/src/record-merge.ts')).toBe(true);
    expect(isPureModulePath('services/read/src/provider-fan-out.ts')).toBe(true);
    expect(isPureModulePath('services/read/src/read-cache-policy.ts')).toBe(true);
    expect(isPureModulePath('services/read/src/read-handler.ts')).toBe(false);
    expect(isPureModulePath('services/read/src/adapters/http-read-adapter.ts')).toBe(false);
    expect(isPureModulePath('services/read/src/aggregate-etag.ts.bak')).toBe(false);
  });

  it('finds a forbidden import in a listed file', () => {
    expect(
      findForbiddenImports(
        'services/read/src/record-merge.ts',
        "import { request } from 'node:http';",
      ),
    ).toHaveLength(1);
  });
});

describe('findForbiddenImports', () => {
  it.each([
    ["import { DynamoDBClient } from '@aws-sdk/client-dynamodb';", '@aws-sdk/client-dynamodb'],
    ["import type { Stack } from 'aws-cdk-lib';", 'aws-cdk-lib'],
    ["import { aws_lambda } from 'aws-cdk-lib/aws-lambda';", 'aws-cdk-lib/aws-lambda'],
    ["import { Logger } from '@aws-lambda-powertools/logger';", '@aws-lambda-powertools/logger'],
    ["import { readFileSync } from 'node:fs';", 'node:fs'],
    ["import { readFile } from 'fs/promises';", 'fs/promises'],
    ["import { createServer } from 'net';", 'net'],
    ["import { request } from 'node:http';", 'node:http'],
    ["import { spawn } from 'node:child_process';", 'node:child_process'],
    ["export { readFileSync } from 'node:fs';", 'node:fs'],
    ["const fileSystem = await import('node:fs');", 'node:fs'],
    ["const childProcess = require('child_process');", 'child_process'],
  ])('finds %s', (sourceText, specifier) => {
    expect(findForbiddenImports('packages/contracts/src/planted.ts', sourceText)).toEqual([
      expect.objectContaining({ line: 1, specifier }) as unknown,
    ]);
  });

  it.each([
    "import { z } from 'zod';",
    "import type { APIGatewayProxyEventV2 } from 'aws-lambda';",
    "import { contractBounds } from './bounds';",
    "import { createHash } from 'node:crypto';",
    "import { https } from 'node:https';",
    'const text = \'import fs from "node:fs"\';',
  ])('allows %s', (sourceText) => {
    expect(findForbiddenImports('packages/contracts/src/fine.ts', sourceText)).toEqual([]);
  });

  it('ignores files outside the pure module directories', () => {
    expect(findForbiddenImports('packages/test-doubles/src/index.ts', "import 'node:fs';")).toEqual(
      [],
    );
  });

  it('reports the line of each forbidden import', () => {
    const findings = findForbiddenImports(
      'packages/contracts/src/planted.ts',
      "import { z } from 'zod';\n\nimport { spawn } from 'child_process';",
    );
    expect(findings.map((finding) => finding.line)).toEqual([3]);
  });
});
