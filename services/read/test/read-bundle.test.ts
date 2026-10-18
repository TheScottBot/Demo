// RE5: the read function's bundle holds its runtime code only: no CDK (the
// reason for the Spec 00 runtime subpath) and no test doubles.
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const readEntry = fileURLToPath(new URL('../src/read-handler-entry.ts', import.meta.url));

describe('the read function bundle', () => {
  it('holds no CDK, constructs, msw or test double code', async () => {
    const bundle = await build({
      entryPoints: [readEntry],
      bundle: true,
      write: false,
      metafile: true,
      platform: 'node',
      format: 'esm',
      // As the Lambda runtime provides it (CU2: external for an explicit runtime).
      external: ['@aws-sdk/*'],
      logLevel: 'silent',
    });
    const bundledInputs = Object.keys(bundle.metafile.inputs);
    expect(bundledInputs.some((inputPath) => inputPath.includes('read-handler.ts'))).toBe(true);
    expect(
      bundledInputs.filter((inputPath) =>
        /aws-cdk-lib|node_modules\/constructs\/|node_modules\/msw\/|packages\/test-doubles\//.test(
          inputPath,
        ),
      ),
    ).toEqual([]);
  }, 60_000);
});
