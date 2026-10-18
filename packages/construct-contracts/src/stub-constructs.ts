import { fileURLToPath } from 'node:url';
import type { PublicRouteName } from '@demo/contracts';
import { Duration, type aws_lambda as lambda } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import type {
  DemoStage,
  ReadPathOutputs,
  ReadPathProperties,
  WritePathOutputs,
  WritePathProperties,
} from './construct-properties';
import { createDemoNodejsFunction } from './demo-nodejs-function';

// Spec 00 CE5: stand ins for Spec 02's ReadPath and Spec 03's WritePath,
// implementing their outputs so the app can wire every stage before the real
// constructs exist (CE6 replaces them outside the stub stage).

const stubEntryPath = fileURLToPath(new URL('./runtime/stub-function-entry.ts', import.meta.url));

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
  return createDemoNodejsFunction(scope, constructId, {
    stage,
    component,
    entry: stubEntryPath,
    environment: { DEMO_STAGE: stage, DEMO_STUB_ROUTE: routeName },
    memorySize: stubFunctionMemoryMegabytes,
    timeout: stubFunctionTimeout,
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
