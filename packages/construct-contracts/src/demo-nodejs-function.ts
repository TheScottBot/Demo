import { fileURLToPath } from 'node:url';
import {
  aws_lambda as lambda,
  aws_lambda_nodejs as lambdaNodejs,
  type Duration,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import type { DemoStage } from './construct-properties';
import { demoResourceName } from './resource-naming';

// Every Lambda in the family is built here, so its runtime, architecture,
// bundling and source map settings live in one place (datum 0.7). Memory,
// timeout and environment are the caller's: they are tuning values each
// construct keeps for itself (Spec 00 §3.11).

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const lockFilePath = fileURLToPath(new URL('../../../package-lock.json', import.meta.url));

// Powertools Tracer depends on a CommonJS module, so an ESM bundle needs
// require restored (CU5, from the Powertools Tracer documentation).
const esmRequireBanner =
  "import { createRequire } from 'module';const require = createRequire(import.meta.url);";

export interface DemoNodejsFunctionOptions {
  stage: DemoStage;
  component: string;
  entry: string;
  environment: Readonly<Record<string, string>>;
  memorySize: number;
  timeout: Duration;
  // X-Ray active tracing, for a function that traces its own calls.
  activeTracing?: boolean;
}

export function createDemoNodejsFunction(
  scope: Construct,
  constructId: string,
  options: DemoNodejsFunctionOptions,
): lambdaNodejs.NodejsFunction {
  if ('NODE_OPTIONS' in options.environment) {
    throw new Error('node-options-reserved: createDemoNodejsFunction sets NODE_OPTIONS');
  }
  return new lambdaNodejs.NodejsFunction(scope, constructId, {
    functionName: demoResourceName(options.stage, options.component),
    entry: options.entry,
    handler: 'handler',
    // Explicit, never NODEJS_LATEST, which would change under the family
    // without a version decision (CU1, CQ1).
    runtime: lambda.Runtime.NODEJS_24_X,
    architecture: lambda.Architecture.ARM_64,
    memorySize: options.memorySize,
    timeout: options.timeout,
    ...(options.activeTracing === true ? { tracing: lambda.Tracing.ACTIVE } : {}),
    projectRoot: repositoryRoot,
    depsLockFilePath: lockFilePath,
    environment: {
      ...options.environment,
      // CDK 2.273.0 writes the source map but does not turn it on; without
      // this flag Node.js ignores it in stack traces (§2.1, read from the CDK
      // source and `node --help`).
      NODE_OPTIONS: '--enable-source-maps',
    },
    bundling: {
      format: lambdaNodejs.OutputFormat.ESM,
      sourceMap: true,
      banner: esmRequireBanner,
      mainFields: ['module', 'main'],
    },
  });
}
