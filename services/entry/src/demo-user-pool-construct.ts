import { fileURLToPath } from 'node:url';
import {
  createDemoNodejsFunction,
  demoResourceName,
  type DemoStage,
} from '@demo/construct-contracts';
import { scopeNames, scopeResourceServerIdentifier } from '@demo/contracts';
import { Duration, RemovalPolicy, Stack, aws_cognito as cognito } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { demoPoolTenants, tenantAttributeName, tenantScopeName } from './token-claim-mapping';

// Spec 01 §4.2: the demo identity provider ED1 chose, answered 18 October
// 2026. Built by DemoApi when its identity provider is the demo pool.

const tenantAttributeMaximumCharacters = 64;

// Stages holding the two synthetic users (§4.2).
const stagesWithSyntheticUsers: readonly DemoStage[] = ['dev', 'stub'];

const triggerEntry = fileURLToPath(
  new URL('./handlers/pre-token-generation-entry.ts', import.meta.url),
);

const plansWithVersionThreeEvents: readonly string[] = [
  cognito.FeaturePlan.ESSENTIALS,
  cognito.FeaturePlan.PLUS,
];

// Compared with the resolved template, which holds the version as a string.
const versionThreeEvent: string = cognito.LambdaVersion.V3_0;

interface ResolvedLambdaConfig {
  readonly PreTokenGenerationConfig?: { readonly LambdaVersion?: string };
  readonly preTokenGenerationConfig?: { readonly lambdaVersion?: string };
}

// §4.2: synth fails when the configured trigger cannot add tenant_id to a
// client credentials access token, since every handler would refuse that
// token. Under EU6 that needs a pre token generation trigger on the V3_0
// event, which only the Essentials and Plus plans send.
export function requireTenantClaimTrigger(userPool: cognito.UserPool): void {
  userPool.node.addValidation({
    validate: () => {
      const cfnUserPool = userPool.node.defaultChild as cognito.CfnUserPool;
      const resolve = (value: unknown): unknown => Stack.of(userPool).resolve(value);
      const lambdaConfig = resolve(cfnUserPool.lambdaConfig) as ResolvedLambdaConfig | undefined;
      const triggerConfig =
        lambdaConfig?.PreTokenGenerationConfig?.LambdaVersion ??
        lambdaConfig?.preTokenGenerationConfig?.lambdaVersion;
      if (triggerConfig === undefined) {
        return ['tenant-claim-trigger-missing: §4.2 needs a pre token generation trigger'];
      }
      if (triggerConfig !== versionThreeEvent) {
        return ['tenant-claim-trigger-not-v3: client credentials tokens reach only V3_0 (EU6)'];
      }
      const userPoolTier = resolve(cfnUserPool.userPoolTier);
      if (typeof userPoolTier !== 'string' || !plansWithVersionThreeEvents.includes(userPoolTier)) {
        return ['tenant-claim-plan-without-v3: V3_0 needs the Essentials or Plus plan (EU6)'];
      }
      return [];
    },
  });
}

export interface DemoUserPoolProperties {
  stage: DemoStage;
}

export class DemoUserPool extends Construct {
  readonly issuerUrl: string;
  // The app clients' identifiers. Cognito access tokens carry client_id and
  // no aud, and the authoriser checks client_id against these (CU4).
  readonly audiences: readonly string[];

  constructor(scope: Construct, constructId: string, properties: DemoUserPoolProperties) {
    super(scope, constructId);
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: demoResourceName(properties.stage, 'users'),
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      selfSignUpEnabled: false,
      customAttributes: {
        [tenantAttributeName]: new cognito.StringAttribute({
          minLen: 1,
          maxLen: tenantAttributeMaximumCharacters,
          mutable: false,
        }),
      },
      // Synthetic data only (Spec 00 §2.3): nothing here is worth keeping.
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const trigger = createDemoNodejsFunction(this, 'PreTokenGenerationFunction', {
      stage: properties.stage,
      component: 'pre-token-generation',
      entry: triggerEntry,
      environment: {},
      memorySize: 256,
      timeout: Duration.seconds(5),
    });
    userPool.addTrigger(
      cognito.UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG,
      trigger,
      cognito.LambdaVersion.V3_0,
    );
    requireTenantClaimTrigger(userPool);

    // The token endpoint client credentials need. The prefix must be unique
    // in the region, which only a deployment can show (deviation entry 3).
    userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: demoResourceName(properties.stage, 'users') },
    });

    // Contract 1.2.0 (EQ6): the identifier readAuthenticationContext reads.
    const recordsReadScope = new cognito.ResourceServerScope({
      scopeName: scopeNames.recordsRead,
      scopeDescription: 'Read records',
    });
    const recordsWriteScope = new cognito.ResourceServerScope({
      scopeName: scopeNames.recordsWrite,
      scopeDescription: 'Submit commands and read their operations',
    });
    const tenantScopes = demoPoolTenants.map(
      (tenantId) =>
        new cognito.ResourceServerScope({
          scopeName: tenantScopeName(tenantId),
          scopeDescription: 'Names the tenant the client serves',
        }),
    );
    const resourceServer = userPool.addResourceServer('ResourceServer', {
      identifier: scopeResourceServerIdentifier,
      scopes: [recordsReadScope, recordsWriteScope, ...tenantScopes],
    });

    // EQ3: one app client per tenant, each allowed its own tenant scope alone
    // (EQ5), so the tenant is never the client's to choose.
    const clients = demoPoolTenants.map((tenantId, tenantIndex) => {
      const client = userPool.addClient(`Client-${tenantId}`, {
        userPoolClientName: demoResourceName(properties.stage, `client-${tenantId}`),
        generateSecret: true,
        authFlows: {},
        oAuth: {
          flows: { clientCredentials: true },
          scopes: [recordsReadScope, recordsWriteScope, tenantScopes[tenantIndex]].map(
            (resourceServerScope) => {
              if (resourceServerScope === undefined) {
                throw new Error('tenant-scope-missing');
              }
              return cognito.OAuthScope.resourceServer(resourceServer, resourceServerScope);
            },
          ),
        },
      });
      // With no flows set, the CDK leaves ExplicitAuthFlows out, and Cognito
      // then allows its user sign in flows by default. Refresh alone signs no
      // one in; client credentials needs no auth flow.
      (client.node.defaultChild as cognito.CfnUserPoolClient).explicitAuthFlows = [
        'ALLOW_REFRESH_TOKEN_AUTH',
      ];
      return client;
    });

    if (stagesWithSyntheticUsers.includes(properties.stage)) {
      for (const tenantId of demoPoolTenants) {
        new cognito.CfnUserPoolUser(this, `SyntheticUser-${tenantId}`, {
          userPoolId: userPool.userPoolId,
          username: `synthetic-user-${tenantId}`,
          // No invitation is sent; the user has no password until the author
          // sets one (§4.2 excludes user management).
          messageAction: 'SUPPRESS',
          userAttributes: [{ name: `custom:${tenantAttributeName}`, value: tenantId }],
        });
      }
    }

    this.issuerUrl = userPool.userPoolProviderUrl;
    this.audiences = clients.map((client) => client.userPoolClientId);
  }
}
