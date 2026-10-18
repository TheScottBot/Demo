// Spec 01 §4.2 and EE2: the demo user pool, by synth assertions, and the
// §4.2 synth failure shown on planted pools.
import { App, Stack, aws_cognito as cognito, aws_lambda as lambda } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import type { DemoStage } from '@demo/construct-contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { DemoUserPool, requireTenantClaimTrigger } from '../src/demo-user-pool-construct';

type Resource = { Properties: Record<string, unknown> };

function synthesise(stage: DemoStage): { template: Template; demoUserPool: DemoUserPool } {
  const stack = new Stack(new App(), `DemoUserPoolTest-${stage}`);
  const demoUserPool = new DemoUserPool(stack, 'DemoUserPool', { stage });
  return { template: Template.fromStack(stack), demoUserPool };
}

let template: Template;
let demoUserPool: DemoUserPool;

beforeAll(() => {
  ({ template, demoUserPool } = synthesise('stub'));
}, 300_000);

function resources(resourceType: string): Resource[] {
  return Object.values(template.findResources(resourceType)) as Resource[];
}

function logicalIdOf(resourceType: string): string {
  const [logicalId] = Object.keys(template.findResources(resourceType));
  if (logicalId === undefined) {
    throw new Error(`no ${resourceType}`);
  }
  return logicalId;
}

describe('the user pool (§4.2)', () => {
  it('is one pool, component users, on the Essentials plan, with self sign up off', () => {
    expect(resources('AWS::Cognito::UserPool')).toHaveLength(1);
    expect(resources('AWS::Cognito::UserPool')[0]?.Properties).toMatchObject({
      UserPoolName: 'demo-stub-users',
      UserPoolTier: 'ESSENTIALS',
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    });
  });

  it('holds the tenant as a custom attribute no user can change', () => {
    expect(resources('AWS::Cognito::UserPool')[0]?.Properties['Schema']).toEqual([
      expect.objectContaining({
        Name: 'tenant_id',
        AttributeDataType: 'String',
        Mutable: false,
        StringAttributeConstraints: { MinLength: '1', MaxLength: '64' },
      }),
    ]);
  });

  it('runs the trigger on the V3_0 event, so client credentials tokens reach it (EU6)', () => {
    const lambdaConfig = resources('AWS::Cognito::UserPool')[0]?.Properties['LambdaConfig'];
    expect(lambdaConfig).toEqual({
      PreTokenGenerationConfig: {
        LambdaArn: { 'Fn::GetAtt': [expect.any(String), 'Arn'] },
        LambdaVersion: 'V3_0',
      },
    });
    const triggerFunction = Object.entries(template.findResources('AWS::Lambda::Function')).find(
      ([, resource]) =>
        (resource as Resource).Properties['FunctionName'] === 'demo-stub-pre-token-generation',
    );
    expect(triggerFunction).toBeDefined();
    expect(
      (lambdaConfig as { PreTokenGenerationConfig: { LambdaArn: { 'Fn::GetAtt': string[] } } })
        .PreTokenGenerationConfig.LambdaArn['Fn::GetAtt'][0],
    ).toBe(triggerFunction?.[0]);
  });

  it('gives the trigger no environment beyond the family default, and so no client table', () => {
    const triggerFunction = resources('AWS::Lambda::Function').find(
      (resource) => resource.Properties['FunctionName'] === 'demo-stub-pre-token-generation',
    );
    expect(triggerFunction?.Properties['Environment']).toEqual({
      Variables: { NODE_OPTIONS: '--enable-source-maps' },
    });
  });

  it('has a domain, so the token endpoint exists for client credentials', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolDomain', {
      Domain: 'demo-stub-users',
      UserPoolId: { Ref: logicalIdOf('AWS::Cognito::UserPool') },
    });
  });
});

describe('the resource server (§4.2, EQ5, EQ6)', () => {
  it('is named by the contract, with the two records scopes and one tenant scope per tenant', () => {
    expect(
      resources('AWS::Cognito::UserPoolResourceServer').map((server) => server.Properties),
    ).toEqual([
      expect.objectContaining({
        Identifier: 'demo',
        Scopes: [
          expect.objectContaining({ ScopeName: 'records:read' }),
          expect.objectContaining({ ScopeName: 'records:write' }),
          expect.objectContaining({ ScopeName: 'tenant:tenant-1' }),
          expect.objectContaining({ ScopeName: 'tenant:tenant-2' }),
        ],
      }),
    ]);
  });
});

describe('the app clients (§4.2, EQ3, EQ5)', () => {
  function clientFor(tenantId: string): Record<string, unknown> | undefined {
    return resources('AWS::Cognito::UserPoolClient').find(
      (client) => client.Properties['ClientName'] === `demo-stub-client-${tenantId}`,
    )?.Properties;
  }

  it('are one per tenant', () => {
    expect(
      resources('AWS::Cognito::UserPoolClient')
        .map((client) => client.Properties['ClientName'])
        .sort(),
    ).toEqual(['demo-stub-client-tenant-1', 'demo-stub-client-tenant-2']);
  });

  it.each([
    ['tenant-1', 'tenant-2'],
    ['tenant-2', 'tenant-1'],
  ])(
    'lets the %s client use client credentials with its own tenant scope only',
    (tenantId, otherTenantId) => {
      const client = clientFor(tenantId);
      expect(client).toMatchObject({
        GenerateSecret: true,
        AllowedOAuthFlows: ['client_credentials'],
        AllowedOAuthFlowsUserPoolClient: true,
      });
      const allowedScopes = JSON.stringify(client?.['AllowedOAuthScopes']);
      expect(allowedScopes).toContain('/records:read');
      expect(allowedScopes).toContain('/records:write');
      expect(allowedScopes).toContain(`/tenant:${tenantId}`);
      expect(allowedScopes).not.toContain(`/tenant:${otherTenantId}`);
      expect(client?.['AllowedOAuthScopes']).toHaveLength(3);
    },
  );

  it('allow no user sign in flow, since no client here signs a user in', () => {
    for (const client of resources('AWS::Cognito::UserPoolClient')) {
      expect(client.Properties['ExplicitAuthFlows']).toEqual(['ALLOW_REFRESH_TOKEN_AUTH']);
      expect(client.Properties['CallbackURLs']).toBeUndefined();
    }
  });

  it('hand their identifiers to the authoriser as its audiences, with the pool as issuer', () => {
    expect(demoUserPool.audiences).toHaveLength(2);
    expect(demoUserPool.issuerUrl).toEqual(expect.any(String));
  });
});

describe('the synthetic users (§4.2)', () => {
  it.each(['dev', 'stub'] as const)(
    'are two in %s, one per tenant, sent no message',
    (stage) => {
      const stageTemplate = stage === 'stub' ? template : synthesise(stage).template;
      const users = Object.values(
        stageTemplate.findResources('AWS::Cognito::UserPoolUser'),
      ) as Resource[];
      expect(users.map((user) => user.Properties)).toEqual([
        expect.objectContaining({
          Username: 'synthetic-user-tenant-1',
          MessageAction: 'SUPPRESS',
          UserAttributes: [{ Name: 'custom:tenant_id', Value: 'tenant-1' }],
        }),
        expect.objectContaining({
          Username: 'synthetic-user-tenant-2',
          MessageAction: 'SUPPRESS',
          UserAttributes: [{ Name: 'custom:tenant_id', Value: 'tenant-2' }],
        }),
      ]);
    },
    300_000,
  );

  it.each(['test', 'demo'] as const)(
    'are absent in %s',
    (stage) => {
      synthesise(stage).template.resourceCountIs('AWS::Cognito::UserPoolUser', 0);
    },
    300_000,
  );
});

describe('the §4.2 synth failure', () => {
  function plantedSynth(configure: (stack: Stack) => cognito.UserPool): () => void {
    return () => {
      const app = new App();
      const stack = new Stack(app, 'PlantedPool');
      requireTenantClaimTrigger(configure(stack));
      app.synth();
    };
  }

  function plantedTrigger(stack: Stack): lambda.IFunction {
    return lambda.Function.fromFunctionArn(
      stack,
      'PlantedTrigger',
      'arn:aws:lambda:eu-west-2:000000000000:function:planted-trigger',
    );
  }

  it('fails a pool without the trigger', () => {
    expect(
      plantedSynth(
        (stack) =>
          new cognito.UserPool(stack, 'Pool', { featurePlan: cognito.FeaturePlan.ESSENTIALS }),
      ),
    ).toThrow('tenant-claim-trigger-missing');
  });

  it('fails a trigger on the V2_0 event, which client credentials tokens never reach', () => {
    expect(
      plantedSynth((stack) => {
        const pool = new cognito.UserPool(stack, 'Pool', {
          featurePlan: cognito.FeaturePlan.ESSENTIALS,
        });
        pool.addTrigger(
          cognito.UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG,
          plantedTrigger(stack),
          cognito.LambdaVersion.V2_0,
        );
        return pool;
      }),
    ).toThrow('tenant-claim-trigger-not-v3');
  });

  it('fails a pool on the Lite plan, which has no V3_0 event', () => {
    expect(
      plantedSynth((stack) => {
        const pool = new cognito.UserPool(stack, 'Pool', { featurePlan: cognito.FeaturePlan.LITE });
        pool.addTrigger(
          cognito.UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG,
          plantedTrigger(stack),
          cognito.LambdaVersion.V3_0,
        );
        return pool;
      }),
    ).toThrow('tenant-claim-plan-without-v3');
  });

  it('guards the pool this construct builds, should its trigger be changed', () => {
    const app = new App();
    const stack = new Stack(app, 'GuardedPool');
    const guarded = new DemoUserPool(stack, 'DemoUserPool', { stage: 'test' });
    const cfnUserPool = guarded.node.findChild('UserPool').node.defaultChild as cognito.CfnUserPool;
    cfnUserPool.userPoolTier = cognito.FeaturePlan.LITE;
    expect(() => app.synth()).toThrow('tenant-claim-plan-without-v3');
  }, 300_000);

  it('passes the pool this construct builds', () => {
    expect(() => synthesise('test')).not.toThrow();
  }, 300_000);
});
