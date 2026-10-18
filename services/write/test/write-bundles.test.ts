// WE3: the relay and sweep bundles hold their runtime code only: no CDK, no
// constructs, no test doubles.
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

// Each entry, and a module its bundle must hold, to show it built the right
// thing: the relay and sweep both enqueue; the worker does not.
const entries = {
  relay: [
    fileURLToPath(new URL('../src/handlers/relay-handler-entry.ts', import.meta.url)),
    'enqueue-operation.ts',
  ],
  sweep: [
    fileURLToPath(new URL('../src/handlers/sweep-handler-entry.ts', import.meta.url)),
    'enqueue-operation.ts',
  ],
  worker: [
    fileURLToPath(new URL('../src/handlers/worker-handler-entry.ts', import.meta.url)),
    'worker-handler.ts',
  ],
  intake: [
    fileURLToPath(new URL('../src/handlers/intake-handler-entry.ts', import.meta.url)),
    'intake-handler.ts',
  ],
  status: [
    fileURLToPath(new URL('../src/handlers/status-handler-entry.ts', import.meta.url)),
    'status-handler.ts',
  ],
} as const;

describe('the write path bundles', () => {
  it.each(Object.entries(entries))(
    'the %s bundle holds no CDK or test double code',
    async (_name, [entry, expectedModule]) => {
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
      expect(bundledInputs.some((inputPath) => inputPath.includes(expectedModule))).toBe(true);
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
