// WE3: the relay and sweep bundles hold their runtime code only: no CDK, no
// constructs, no test doubles.
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const entries = {
  relay: fileURLToPath(new URL('../src/handlers/relay-handler-entry.ts', import.meta.url)),
  sweep: fileURLToPath(new URL('../src/handlers/sweep-handler-entry.ts', import.meta.url)),
};

describe('the write path bundles', () => {
  it.each(Object.entries(entries))(
    'the %s bundle holds no CDK or test double code',
    async (_name, entry) => {
      const bundle = await build({
        entryPoints: [entry],
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
      expect(bundledInputs.some((inputPath) => inputPath.includes('enqueue-operation.ts'))).toBe(
        true,
      );
      expect(
        bundledInputs.filter((inputPath) =>
          /aws-cdk-lib|node_modules\/constructs\/|node_modules\/msw\/|packages\/test-doubles\//.test(
            inputPath,
          ),
        ),
      ).toEqual([]);
    },
    60_000,
  );
});
