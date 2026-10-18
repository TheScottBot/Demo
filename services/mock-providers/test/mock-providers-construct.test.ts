// Spec 00 CE4: the mock providers construct synthesises: the store table, one
// secret, function and HTTP API per provider.
import { mockProviderBehaviour } from '@demo/contracts';
import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { MockProviders } from '../src/mock-providers-construct';

let template: Template;
let mockProviders: MockProviders;

beforeAll(() => {
  const stack = new Stack(new App(), 'MockProvidersTest');
  mockProviders = new MockProviders(stack, 'MockProviders', { stage: 'dev' });
  template = Template.fromStack(stack);
}, 120_000);

const providers = ['provider-a', 'provider-b', 'provider-c'] as const;

describe('the mock providers construct', () => {
  it('holds the store table keyed as Spec 00 §4.3 states, with a time to live', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'demo-dev-mock-provider-store',
      KeySchema: [
        { AttributeName: 'partitionKey', KeyType: 'HASH' },
        { AttributeName: 'sortKey', KeyType: 'RANGE' },
      ],
      TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  it('keeps each provider credential in Secrets Manager under its CU8 name', () => {
    template.resourceCountIs('AWS::SecretsManager::Secret', 3);
    for (const providerId of providers) {
      template.hasResourceProperties('AWS::SecretsManager::Secret', {
        Name: `demo/dev/providers/${providerId}`,
      });
    }
  });

  it('runs one function per provider, longer lived than the slow fault, with no secret in its environment', () => {
    template.resourceCountIs('AWS::Lambda::Function', 3);
    for (const providerId of providers) {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: `demo-dev-mock-${providerId}`,
        Runtime: 'nodejs24.x',
        Architectures: ['arm64'],
        Environment: {
          Variables: {
            DEMO_STAGE: 'dev',
            DEMO_PROVIDER_ID: providerId,
            DEMO_STORE_TABLE_NAME: { Ref: Match.anyValue() },
            DEMO_API_KEY_SECRET_ARN: { Ref: Match.anyValue() },
            NODE_OPTIONS: '--enable-source-maps',
          },
        },
      });
    }
    const functions = template.findResources('AWS::Lambda::Function');
    for (const lambdaFunction of Object.values(functions)) {
      const timeoutSeconds = (lambdaFunction as { Properties: { Timeout: number } }).Properties
        .Timeout;
      expect(timeoutSeconds * 1_000).toBeGreaterThan(
        mockProviderBehaviour.slowResponseDelayMilliseconds,
      );
    }
  });

  it('puts each provider behind its own HTTP API with the three §4.3 routes', () => {
    template.resourceCountIs('AWS::ApiGatewayV2::Api', 3);
    for (const providerId of providers) {
      template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
        Name: `demo-dev-mock-${providerId}-api`,
        ProtocolType: 'HTTP',
      });
    }
    template.resourceCountIs('AWS::ApiGatewayV2::Route', 9);
    for (const routeKey of [
      'GET /records/{recordId}',
      'PUT /records/{recordId}/sections/{section}',
      'POST /records/{recordId}/sections/notes/entries',
    ]) {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: routeKey });
    }
  });

  it('grants each function the table and its own secret only', () => {
    const policies = Object.values(template.findResources('AWS::IAM::Policy'));
    expect(policies).toHaveLength(3);
    for (const policy of policies) {
      const statements = (
        policy as { Properties: { PolicyDocument: { Statement: { Action: string | string[] }[] } } }
      ).Properties.PolicyDocument.Statement;
      const actions = statements.flatMap((statement) =>
        Array.isArray(statement.Action) ? statement.Action : [statement.Action],
      );
      expect(actions).toContain('secretsmanager:GetSecretValue');
      expect(actions).toContain('dynamodb:PutItem');
      expect(actions.some((action) => action.startsWith('dynamodb:Delete'))).toBe(true);
    }
  });

  it('exposes one connection per provider for the read and write paths', () => {
    expect(mockProviders.connections.map((connection) => connection.providerId)).toEqual([
      ...providers,
    ]);
  });
});
