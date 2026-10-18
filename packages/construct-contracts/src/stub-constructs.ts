import { fileURLToPath } from 'node:url';
import type { PublicRouteName } from '@demo/contracts';
import { Duration, aws_lambda as lambda, aws_lambda_nodejs as lambdaNodejs } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import type {
  DemoStage,
  ReadPathOutputs,
  ReadPathProperties,
  WritePathOutputs,
  WritePathProperties,
} from './construct-properties';
import { demoResourceName } from './resource-naming';

// Spec 00 CE5: stand ins for Spec 02's ReadPath and Spec 03's WritePath,
// implementing their outputs so the app can wire every stage before the real
// constructs exist (CE6 replaces them outside the stub stage).

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const stubEntryPath = fileURLToPath(new URL('./runtime/stub-function-entry.ts', import.meta.url));

// Tracer depends on a CommonJS module, so an ESM bundle needs require
// restored (CU5, from the Powertools Tracer documentation).
const esmRequireBanner =
  "import { createRequire } from 'module';const require = createRequire(import.meta.url);";

// Tuning values belong to the construct, not the interface (§3.11).
const stubFunctionMemoryMegabytes = 256;
const stubFunctionTimeout = Duration.seconds(3);

function createStubFunction(
  scope: Construct,
  constructId: string,
  stage: DemoStage,
  component: string,
  routeName: PublicRouteName,
): lambda.IFunction {
  return new lambdaNodejs.NodejsFunction(scope, constructId, {
    functionName: demoResourceName(stage, component),
    entry: stubEntryPath,
    handler: 'handler',
    // Explicit, never NODEJS_LATEST, which would change under the family
    // without a version decision (CU1, CQ1).
    runtime: lambda.Runtime.NODEJS_24_X,
    architecture: lambda.Architecture.ARM_64,
    memorySize: stubFunctionMemoryMegabytes,
    timeout: stubFunctionTimeout,
    projectRoot: repositoryRoot,
    depsLockFilePath: fileURLToPath(
      new URL('package-lock.json', `file:///${repositoryRoot.replaceAll('\\', '/')}`),
    ),
    environment: {
      DEMO_STAGE: stage,
      DEMO_STUB_ROUTE: routeName,
      // CDK 2.273.0 writes the source map but does not turn it on; without
      // this flag Node.js ignores it in stack traces (§2.1, read from the
      // CDK source and `node --help`).
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

export class StubReadPath extends Construct implements ReadPathOutputs {
  readonly readHandler: lambda.IFunction;

  constructor(scope: Construct, constructId: string, properties: ReadPathProperties) {
    super(scope, constructId);
    this.readHandler = createStubFunction(
      this,
      'ReadHandler',
      properties.stage,
      'stub-read',
      'read-record',
    );
  }
}

export class StubWritePath extends Construct implements WritePathOutputs {
  readonly commandHandler: lambda.IFunction;
  readonly statusHandler: lambda.IFunction;

  constructor(scope: Construct, constructId: string, properties: WritePathProperties) {
    super(scope, constructId);
    this.commandHandler = createStubFunction(
      this,
      'CommandHandler',
      properties.stage,
      'stub-command',
      'submit-command',
    );
    this.statusHandler = createStubFunction(
      this,
      'StatusHandler',
      properties.stage,
      'stub-status',
      'read-operation',
    );
  }
}
