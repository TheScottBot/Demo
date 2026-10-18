// Spec 01 §2 to §4.1 and EE1: the DemoApi construct against the Spec 00
// stubs, by synth assertions.
import { App, Stack, aws_sns as sns } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import {
  StubReadPath,
  StubWritePath,
  type DemoApiProperties,
  type DemoStage,
} from '@demo/construct-contracts';
import { publicRoutes } from '@demo/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { DemoApi } from '../src/demo-api-construct';

const externalIssuer = {
  kind: 'external' as const,
  issuerUrl: 'https://issuer.example.test/demo',
  audiences: ['synthetic-audience'],
};

function synthesise(
  stage: DemoStage,
  overrides: Partial<DemoApiProperties> = {},
): { template: Template; demoApi: DemoApi; stack: Stack } {
  const stack = new Stack(
    new App(),
    `DemoApiTest-${stage}-${String(Object.keys(overrides).length)}`,
  );
  const alarmTopic = new sns.Topic(stack, 'AlarmTopic');
  const readPath = new StubReadPath(stack, 'ReadPath', { stage, providers: [], alarmTopic });
  const writePath = new StubWritePath(stack, 'WritePath', {
    stage,
    providers: [],
    alarmTopic,
    relayEnabled: true,
  });
  const demoApi = new DemoApi(stack, 'DemoApi', {
    stage,
    readHandler: readPath.readHandler,
    commandHandler: writePath.commandHandler,
    statusHandler: writePath.statusHandler,
    identityProvider: externalIssuer,
    corsAllowedOrigins: ['https://demo.example.test'],
    alarmTopic,
    ...overrides,
  });
  return { template: Template.fromStack(stack), demoApi, stack };
}

type Resource = { Properties: Record<string, unknown> };

let template: Template;
let demoApi: DemoApi;

beforeAll(() => {
  ({ template, demoApi } = synthesise('stub'));
}, 300_000);

function resources(resourceType: string): Resource[] {
  return Object.values(template.findResources(resourceType)) as Resource[];
}

function functionLogicalId(functionName: string): string {
  const [match] = Object.entries(template.findResources('AWS::Lambda::Function')).filter(
    ([, resource]) => (resource as Resource).Properties['FunctionName'] === functionName,
  );
  if (match === undefined) {
    throw new Error(`no function ${functionName}`);
  }
  return match[0];
}

describe('the HTTP API (§2.1)', () => {
  it('is one HTTP API named for the stage, its default endpoint on', () => {
    expect(resources('AWS::ApiGatewayV2::Api')).toHaveLength(1);
    expect(resources('AWS::ApiGatewayV2::Api')[0]?.Properties).toMatchObject({
      Name: 'demo-stub-api',
      ProtocolType: 'HTTP',
      DisableExecuteApiEndpoint: false,
    });
  });

  it('deploys the default stage automatically', () => {
    expect(resources('AWS::ApiGatewayV2::Stage').map((stage) => stage.Properties)).toEqual([
      expect.objectContaining({ StageName: '$default', AutoDeploy: true }),
    ]);
  });

  it('hands back the stage URL as baseUrl (Spec 00 §3.11)', () => {
    expect(demoApi.baseUrl).toEqual(expect.any(String));
  });
});

describe('the routes (§2.2)', () => {
  it('are exactly the three Spec 00 §3.2 routes, with no default or catch all route (EU3)', () => {
    expect(
      resources('AWS::ApiGatewayV2::Route')
        .map((route) => route.Properties['RouteKey'])
        .sort(),
    ).toEqual(
      publicRoutes.map((publicRoute) => `${publicRoute.method} ${publicRoute.path}`).sort(),
    );
  });

  it.each([
    ['GET /v1/records/{recordId}', 'demo-stub-stub-read', 6_000],
    ['POST /v1/commands', 'demo-stub-stub-command', 10_000],
    ['GET /v1/operations/{operationId}', 'demo-stub-stub-status', 10_000],
  ])(
    'integrates %s with its own function, by Lambda proxy on payload 2.0, within EU10',
    (routeKey, functionName, timeoutInMillis) => {
      const route = resources('AWS::ApiGatewayV2::Route').find(
        (candidate) => candidate.Properties['RouteKey'] === routeKey,
      );
      const integrationLogicalId = (
        route?.Properties['Target'] as { 'Fn::Join': [string, unknown[]] }
      )['Fn::Join'][1].find((part) => typeof part === 'object') as { Ref: string };
      const integration = (
        template.findResources('AWS::ApiGatewayV2::Integration')[
          integrationLogicalId.Ref
        ] as Resource
      ).Properties;
      expect(integration).toMatchObject({
        IntegrationType: 'AWS_PROXY',
        PayloadFormatVersion: '2.0',
        TimeoutInMillis: timeoutInMillis,
      });
      expect(JSON.stringify(integration['IntegrationUri'])).toContain(
        functionLogicalId(functionName),
      );
      // §2.2: the gateway adds, removes and rewrites no header.
      expect(integration['RequestParameters']).toBeUndefined();
      expect(integration['ResponseParameters']).toBeUndefined();
    },
  );

  it('lets each route invoke its function without a resource policy from Specs 02 or 03 (EU4)', () => {
    const permissions = resources('AWS::Lambda::Permission').filter(
      (permission) => permission.Properties['Principal'] === 'apigateway.amazonaws.com',
    );
    for (const functionName of [
      'demo-stub-stub-read',
      'demo-stub-stub-command',
      'demo-stub-stub-status',
    ]) {
      expect(
        permissions.some((permission) =>
          JSON.stringify(permission.Properties['FunctionName']).includes(
            functionLogicalId(functionName),
          ),
        ),
      ).toBe(true);
    }
  });
});

describe('the JWT authoriser (§4.1)', () => {
  it('reads the Authorization header, with the issuer and audiences ED1 configures', () => {
    expect(
      resources('AWS::ApiGatewayV2::Authorizer').map((authorizer) => authorizer.Properties),
    ).toEqual([
      expect.objectContaining({
        AuthorizerType: 'JWT',
        IdentitySource: ['$request.header.Authorization'],
        JwtConfiguration: {
          Issuer: 'https://issuer.example.test/demo',
          Audience: ['synthetic-audience'],
        },
      }),
    ]);
  });

  it('guards all three routes, with no route scopes, so requireScope answers a missing scope', () => {
    const routes = resources('AWS::ApiGatewayV2::Route');
    expect(routes).toHaveLength(3);
    for (const route of routes) {
      expect(route.Properties['AuthorizationType']).toBe('JWT');
      expect(route.Properties['AuthorizerId']).toBeDefined();
      expect(route.Properties['AuthorizationScopes']).toBeUndefined();
    }
  });

  // EE1 refused the demo pool until EE2 built it; EE2 replaced that test with
  // this one.
  it('takes its issuer and audiences from the demo user pool when ED1 chooses it', () => {
    const pooled = synthesise('dev', { identityProvider: { kind: 'demo-user-pool' } }).template;
    pooled.resourceCountIs('AWS::Cognito::UserPool', 1);
    const [poolLogicalId] = Object.keys(pooled.findResources('AWS::Cognito::UserPool'));
    const clientLogicalIds = Object.keys(pooled.findResources('AWS::Cognito::UserPoolClient'));
    const [authorizer] = Object.values(
      pooled.findResources('AWS::ApiGatewayV2::Authorizer'),
    ) as Resource[];
    const jwtConfiguration = authorizer?.Properties['JwtConfiguration'] as {
      Issuer: unknown;
      Audience: unknown[];
    };
    expect(JSON.stringify(jwtConfiguration.Issuer)).toContain(String(poolLogicalId));
    expect(jwtConfiguration.Audience).toEqual(
      clientLogicalIds.map((clientLogicalId) => ({ Ref: clientLogicalId })),
    );
    // Each synthesis bundles the stub functions, which is slow under the full suite.
  }, 300_000);
});

describe('a custom domain (§2.1)', () => {
  it('maps the API to it, and turns the default endpoint off', () => {
    const custom = synthesise('demo', {
      customDomain: {
        domainName: 'api.demo.example.test',
        certificateArn:
          'arn:aws:acm:eu-west-2:000000000000:certificate/00000000-0000-4000-8000-000000000001',
      },
    }).template;
    custom.hasResourceProperties('AWS::ApiGatewayV2::Api', { DisableExecuteApiEndpoint: true });
    custom.hasResourceProperties('AWS::ApiGatewayV2::DomainName', {
      DomainName: 'api.demo.example.test',
    });
    custom.resourceCountIs('AWS::ApiGatewayV2::ApiMapping', 1);
  }, 300_000);
});
