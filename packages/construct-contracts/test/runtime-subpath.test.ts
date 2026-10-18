// Added in Spec 02 RE5 as a Spec 00 change: a runtime only entry to this
// package, so a Lambda can use the Powertools adapter without bundling CDK.
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

describe('@demo/construct-contracts/runtime', () => {
  it('exports the Powertools adapter', async () => {
    const runtimeEntry = await import('@demo/construct-contracts/runtime');
    expect(typeof runtimeEntry.createPowertoolsProblemHandling).toBe('function');
  });

  it('bundles without any CDK or constructs code', async () => {
    const bundle = await build({
      stdin: {
        contents:
          "import { createPowertoolsProblemHandling } from '@demo/construct-contracts/runtime';\nconsole.log(createPowertoolsProblemHandling);\n",
        resolveDir: repositoryRoot,
        loader: 'ts',
      },
      bundle: true,
      write: false,
      metafile: true,
      platform: 'node',
      format: 'esm',
      logLevel: 'silent',
    });
    const bundledInputs = Object.keys(bundle.metafile.inputs);
    expect(bundledInputs.some((inputPath) => inputPath.includes('@aws-lambda-powertools'))).toBe(
      true,
    );
    expect(
      bundledInputs.filter((inputPath) => /aws-cdk-lib|node_modules\/constructs\//.test(inputPath)),
    ).toEqual([]);
  }, 60_000);
});
