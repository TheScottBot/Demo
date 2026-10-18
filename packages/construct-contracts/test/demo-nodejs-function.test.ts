// The one place every family Lambda takes its runtime, architecture, bundling
// and source map settings from (a CE5 finding, built in CE4).
import { fileURLToPath } from 'node:url';
import { App, Duration, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { createDemoNodejsFunction } from '../src/index';

const stubEntry = fileURLToPath(new URL('../src/runtime/stub-function-entry.ts', import.meta.url));

describe('createDemoNodejsFunction', () => {
  it('builds a Node.js 24 arm64 function, named for its stage, with source maps on', () => {
    const stack = new Stack(new App(), 'HelperTest');
    createDemoNodejsFunction(stack, 'Example', {
      stage: 'test',
      component: 'example-function',
      entry: stubEntry,
      environment: { DEMO_STAGE: 'test', DEMO_STUB_ROUTE: 'read-record' },
      memorySize: 512,
      timeout: Duration.seconds(7),
    });
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'demo-test-example-function',
      Runtime: 'nodejs24.x',
      Architectures: ['arm64'],
      MemorySize: 512,
      Timeout: 7,
      Environment: {
        Variables: {
          DEMO_STAGE: 'test',
          DEMO_STUB_ROUTE: 'read-record',
          NODE_OPTIONS: '--enable-source-maps',
        },
      },
    });
    // Bundling a real function takes seconds when the whole suite runs at once.
  }, 60_000);

  it('refuses a caller setting NODE_OPTIONS, which it owns', () => {
    const stack = new Stack(new App(), 'HelperOverrideTest');
    expect(() =>
      createDemoNodejsFunction(stack, 'Example', {
        stage: 'test',
        component: 'example-function',
        entry: stubEntry,
        environment: { NODE_OPTIONS: '--inspect' },
        memorySize: 256,
        timeout: Duration.seconds(3),
      }),
    ).toThrow('node-options-reserved');
  });
});

// Added in Spec 02 RE5 as a Spec 00 change: active tracing, which the read
// path's subsegment per provider call needs (Spec 02 §8).
describe('createDemoNodejsFunction tracing', () => {
  it('turns on active tracing when asked, and leaves it off otherwise', () => {
    const stack = new Stack(new App(), 'TracingTest');
    createDemoNodejsFunction(stack, 'Traced', {
      stage: 'test',
      component: 'traced-function',
      entry: stubEntry,
      environment: { DEMO_STAGE: 'test', DEMO_STUB_ROUTE: 'read-record' },
      memorySize: 256,
      timeout: Duration.seconds(3),
      activeTracing: true,
    });
    createDemoNodejsFunction(stack, 'Untraced', {
      stage: 'test',
      component: 'untraced-function',
      entry: stubEntry,
      environment: { DEMO_STAGE: 'test', DEMO_STUB_ROUTE: 'read-record' },
      memorySize: 256,
      timeout: Duration.seconds(3),
    });
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'demo-test-traced-function',
      TracingConfig: { Mode: 'Active' },
    });
    const untraced = Object.values(template.findResources('AWS::Lambda::Function')).find(
      (lambdaFunction) =>
        (lambdaFunction as { Properties: { FunctionName: string } }).Properties.FunctionName ===
        'demo-test-untraced-function',
    ) as { Properties: Record<string, unknown> } | undefined;
    expect(untraced?.Properties['TracingConfig']).toBeUndefined();
  }, 60_000);
});
