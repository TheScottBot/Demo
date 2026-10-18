// Spec 00 CE5: synth assertions that each stage holds the alarm topic and the
// constructs Spec 00 §2.3 assigns it. Until CE6 every stage holds the stubs.
// Since Spec 01 EE2, DemoApi is wired too (CQ9), on the demo user pool (ED1);
// its trigger is the one function beside the stubs.
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
    const functionNames = Object.values(template?.findResources('AWS::Lambda::Function') ?? {})
      .map(
        (lambdaFunction) =>
          (lambdaFunction as { Properties: { FunctionName: string } }).Properties.FunctionName,
      )
      .sort();
    expect(functionNames).toEqual([
      `demo-${stage}-pre-token-generation`,
      `demo-${stage}-stub-command`,
      `demo-${stage}-stub-read`,
      `demo-${stage}-stub-status`,
    ]);
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
      const { FunctionName: functionName, Environment: environment } = (
        lambdaFunction as {
          Properties: { FunctionName: string; Environment: { Variables: Record<string, unknown> } };
        }
      ).Properties;
      expect(Object.keys(environment.Variables).sort()).toEqual(
        functionName.endsWith('-pre-token-generation')
          ? ['NODE_OPTIONS']
          : ['DEMO_STAGE', 'DEMO_STUB_ROUTE', 'NODE_OPTIONS'],
      );
    }
  });

  it('holds DemoApi on the demo user pool, its routes on the stub functions (CQ9, ED1)', () => {
    const template = templatesByStage[stage];
    template?.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
    template?.hasResourceProperties('AWS::ApiGatewayV2::Api', { Name: `demo-${stage}-api` });
    template?.resourceCountIs('AWS::ApiGatewayV2::Route', 3);
    template?.resourceCountIs('AWS::Cognito::UserPool', 1);
    template?.hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolName: `demo-${stage}-users`,
    });
  });

  it('allows only the local client origin, since nothing is deployed and no web client exists', () => {
    templatesByStage[stage]?.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: Match.objectLike({ AllowOrigins: ['http://localhost:3000'] }),
    });
  });

  it('sends every alarm to the stage topic', () => {
    const template = templatesByStage[stage];
    const [topicLogicalId] = Object.keys(template?.findResources('AWS::SNS::Topic') ?? {});
    for (const alarm of Object.values(template?.findResources('AWS::CloudWatch::Alarm') ?? {})) {
      expect((alarm as { Properties: { AlarmActions: unknown } }).Properties.AlarmActions).toEqual([
        { Ref: topicLogicalId },
      ]);
    }
  });
});
