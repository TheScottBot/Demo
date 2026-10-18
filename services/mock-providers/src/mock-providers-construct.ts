import { fileURLToPath } from 'node:url';
import { mockProviderBehaviour, providerIdentifiers } from '@demo/contracts';
import {
  createDemoNodejsFunction,
  demoResourceName,
  providerSecretName,
  type DemoStage,
  type ProviderConnection,
} from '@demo/construct-contracts';
import {
  Duration,
  RemovalPolicy,
  aws_apigatewayv2 as apigatewayv2,
  aws_apigatewayv2_integrations as apigatewayv2Integrations,
  aws_dynamodb as dynamodb,
  aws_secretsmanager as secretsmanager,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { mockProviderStoreAttributes } from './dynamodb-provider-store';
import { mockProviderStoreTableName } from './seed';

// Spec 00 §4.3: one Lambda per provider behind its own HTTP API, each
// authenticated by X-Api-Key from Secrets Manager, all three sharing the
// store table. Built to synthesise; under CQ6 nothing is deployed, and the
// same handlers run locally instead.

const mockProviderEntryPath = fileURLToPath(new URL('./mock-provider-entry.ts', import.meta.url));

// Tuning values belong to the construct (Spec 00 §3.11). The timeout leaves
// room for the slow- faults (CU9) and a store round trip after them.
const mockProviderMemoryMegabytes = 256;
const mockProviderTimeout = Duration.millis(
  mockProviderBehaviour.slowResponseDelayMilliseconds + 7_000,
);

const mockProviderRoutes: readonly { path: string; method: apigatewayv2.HttpMethod }[] = [
  { path: '/records/{recordId}', method: apigatewayv2.HttpMethod.GET },
  { path: '/records/{recordId}/sections/{section}', method: apigatewayv2.HttpMethod.PUT },
  { path: '/records/{recordId}/sections/notes/entries', method: apigatewayv2.HttpMethod.POST },
];

export interface MockProvidersProperties {
  stage: DemoStage;
}

export class MockProviders extends Construct {
  readonly connections: readonly ProviderConnection[];
  readonly storeTable: dynamodb.ITable;

  constructor(scope: Construct, constructId: string, properties: MockProvidersProperties) {
    super(scope, constructId);
    const { stage } = properties;
    const storeTable = new dynamodb.Table(this, 'StoreTable', {
      tableName: mockProviderStoreTableName(stage),
      partitionKey: {
        name: mockProviderStoreAttributes.partitionKey,
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: { name: mockProviderStoreAttributes.sortKey, type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: mockProviderStoreAttributes.expiresAt,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // Synthetic data only (Spec 00 §3.7), recreated by the seed.
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.storeTable = storeTable;

    this.connections = providerIdentifiers.map((providerId) => {
      const apiKeySecret = new secretsmanager.Secret(this, `${providerId}-api-key`, {
        secretName: providerSecretName(stage, providerId),
        generateSecretString: { passwordLength: 40, excludePunctuation: true },
      });
      const providerFunction = createDemoNodejsFunction(this, `${providerId}-function`, {
        stage,
        component: `mock-${providerId}`,
        entry: mockProviderEntryPath,
        environment: {
          DEMO_STAGE: stage,
          DEMO_PROVIDER_ID: providerId,
          DEMO_STORE_TABLE_NAME: storeTable.tableName,
          // The secret's ARN, not its value (§2.3).
          DEMO_API_KEY_SECRET_ARN: apiKeySecret.secretArn,
        },
        memorySize: mockProviderMemoryMegabytes,
        timeout: mockProviderTimeout,
      });
      storeTable.grantReadWriteData(providerFunction);
      apiKeySecret.grantRead(providerFunction);
      const httpApi = new apigatewayv2.HttpApi(this, `${providerId}-api`, {
        apiName: demoResourceName(stage, `mock-${providerId}-api`),
      });
      const integration = new apigatewayv2Integrations.HttpLambdaIntegration(
        `${providerId}-integration`,
        providerFunction,
      );
      for (const mockProviderRoute of mockProviderRoutes) {
        httpApi.addRoutes({
          path: mockProviderRoute.path,
          methods: [mockProviderRoute.method],
          integration,
        });
      }
      return { providerId, baseUrl: httpApi.apiEndpoint, secretArn: apiKeySecret.secretArn };
    });
  }
}
