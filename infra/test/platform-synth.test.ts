// Spec 00 CE5: synth assertions that each stage holds the alarm topic and the
// constructs Spec 00 §2.3 assigns it. Until CE6 every stage holds the stubs.
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildDemoPlatform } from '../lib/demo-platform';

let templatesByStage: Record<string, Template>;
let stackNames: string[];

beforeAll(() => {
  const app = new App();
  const stacks = buildDemoPlatform(app);
  stackNames = stacks.map((stack) => stack.stackName);
  templatesByStage = Object.fromEntries(
    stacks.map((stack) => [
      stack.stackName.replace('DemoPlatform-', ''),
      Template.fromStack(stack),
    ]),
  );
}, 120_000);

const stages = ['dev', 'stub', 'test', 'demo'] as const;

const stubFunctions = [
  { component: 'stub-read', routeName: 'read-record' },
  { component: 'stub-command', routeName: 'submit-command' },
  { component: 'stub-status', routeName: 'read-operation' },
] as const;

describe('the CDK app', () => {
  it('holds one stack per stage', () => {
    expect(stackNames).toEqual([
      'DemoPlatform-dev',
      'DemoPlatform-stub',
      'DemoPlatform-test',
      'DemoPlatform-demo',
    ]);
  });
});

describe.each(stages)('the %s stack', (stage) => {
  it('holds exactly one alarm topic, named for the stage', () => {
    const template = templatesByStage[stage];
    template?.resourceCountIs('AWS::SNS::Topic', 1);
    template?.hasResourceProperties('AWS::SNS::Topic', { TopicName: `demo-${stage}-alarms` });
  });

  it('holds the three stub functions on Node.js 24, arm64', () => {
    const template = templatesByStage[stage];
    template?.resourceCountIs('AWS::Lambda::Function', 3);
    for (const stubFunction of stubFunctions) {
      template?.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: `demo-${stage}-${stubFunction.component}`,
        Runtime: 'nodejs24.x',
        Architectures: ['arm64'],
        Environment: {
          Variables: Match.objectLike({
            DEMO_STAGE: stage,
            DEMO_STUB_ROUTE: stubFunction.routeName,
          }),
        },
      });
    }
  });

  it('puts no secret in an environment variable (Spec 00 §2.3)', () => {
    const functions = templatesByStage[stage]?.findResources('AWS::Lambda::Function') ?? {};
    for (const lambdaFunction of Object.values(functions)) {
      const variables = (
        lambdaFunction as { Properties: { Environment: { Variables: Record<string, unknown> } } }
      ).Properties.Environment.Variables;
      expect(Object.keys(variables).sort()).toEqual([
        'DEMO_STAGE',
        'DEMO_STUB_ROUTE',
        'NODE_OPTIONS',
      ]);
    }
  });
});
