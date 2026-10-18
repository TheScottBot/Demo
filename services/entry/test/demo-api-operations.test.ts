// Spec 01 §5 and EE3: throttling, CORS, access logs and alarms on DemoApi, by
// synth assertions against the Spec 00 stubs.
import { App, Stack, aws_sns as sns } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import {
  StubReadPath,
  StubWritePath,
  type DemoApiProperties,
  type DemoStage,
} from '@demo/construct-contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { DemoApi } from '../src/demo-api-construct';

type Resource = { Properties: Record<string, unknown> };

let synthesisCount = 0;

function synthesise(
  stage: DemoStage,
  overrides: Partial<DemoApiProperties> = {},
): { template: Template; alarmTopicLogicalId: string } {
  synthesisCount += 1;
  const stack = new Stack(new App(), `DemoApiOperations-${stage}-${String(synthesisCount)}`);
  const alarmTopic = new sns.Topic(stack, 'AlarmTopic');
  const readPath = new StubReadPath(stack, 'ReadPath', { stage, providers: [], alarmTopic });
  const writePath = new StubWritePath(stack, 'WritePath', {
    stage,
    providers: [],
    alarmTopic,
    relayEnabled: true,
  });
  new DemoApi(stack, 'DemoApi', {
    stage,
    readHandler: readPath.readHandler,
    commandHandler: writePath.commandHandler,
    statusHandler: writePath.statusHandler,
    identityProvider: {
      kind: 'external',
      issuerUrl: 'https://issuer.example.test/demo',
      audiences: ['synthetic-audience'],
    },
    corsAllowedOrigins: ['https://demo.example.test'],
    alarmTopic,
    ...overrides,
  });
  return {
    template: Template.fromStack(stack),
    alarmTopicLogicalId: stack.getLogicalId(alarmTopic.node.defaultChild as never),
  };
}

let template: Template;
let alarmTopicLogicalId: string;

beforeAll(() => {
  ({ template, alarmTopicLogicalId } = synthesise('stub'));
}, 300_000);

function resources(resourceType: string): Resource[] {
  return Object.values(template.findResources(resourceType)) as Resource[];
}

function stageProperties(): Record<string, unknown> {
  const [stage] = resources('AWS::ApiGatewayV2::Stage');
  if (stage === undefined) {
    throw new Error('no stage');
  }
  return stage.Properties;
}

describe('throttling (§5.1, EU7, EU11)', () => {
  it('sets a rate and burst on each route', () => {
    expect(stageProperties()['RouteSettings']).toEqual({
      'GET /v1/records/{recordId}': {
        ThrottlingRateLimit: 100,
        ThrottlingBurstLimit: 200,
        DetailedMetricsEnabled: true,
      },
      'POST /v1/commands': { ThrottlingRateLimit: 50, ThrottlingBurstLimit: 100 },
      'GET /v1/operations/{operationId}': { ThrottlingRateLimit: 100, ThrottlingBurstLimit: 200 },
    });
  });
});

describe('CORS (§5.3)', () => {
  it('derives every list from the contract headers, with the EU12 maximum age', () => {
    expect(resources('AWS::ApiGatewayV2::Api')[0]?.Properties['CorsConfiguration']).toEqual({
      AllowOrigins: ['https://demo.example.test'],
      AllowMethods: ['GET', 'POST', 'OPTIONS'],
      AllowHeaders: [
        'Authorization',
        'Content-Type',
        'Idempotency-Key',
        'If-None-Match',
        'X-Correlation-Id',
      ],
      ExposeHeaders: ['ETag', 'Location', 'X-Correlation-Id', 'Retry-After', 'Idempotent-Replayed'],
      MaxAge: 600,
    });
  });

  it.each(['stub', 'test', 'demo'] as const)(
    'refuses a wildcard origin in %s',
    (stage) => {
      expect(() => synthesise(stage, { corsAllowedOrigins: ['*'] })).toThrow(
        'cors-wildcard-outside-dev',
      );
      // Each synthesis bundles the stub functions, which is slow under the full suite.
    },
    300_000,
  );

  it('allows a wildcard origin in dev', () => {
    const dev = synthesise('dev', { corsAllowedOrigins: ['*'] }).template;
    dev.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: { AllowOrigins: ['*'] },
    });
  }, 300_000);
});

describe('access logs (§5.4, EU9, EU12)', () => {
  function accessLogFormat(): Record<string, unknown> {
    const accessLogSettings = stageProperties()['AccessLogSettings'] as { Format: string };
    return JSON.parse(accessLogSettings.Format) as Record<string, unknown>;
  }

  it('writes structured JSON carrying exactly the §5.4 fields', () => {
    expect(accessLogFormat()).toEqual({
      requestId: '$context.requestId',
      routeKey: '$context.routeKey',
      status: '$context.status',
      responseLatency: '$context.responseLatency',
      integrationLatency: '$context.integrationLatency',
      integrationErrorMessage: '$context.integrationErrorMessage',
      authorizerError: '$context.authorizer.error',
      tenantId: '$context.authorizer.claims.tenant_id',
    });
  });

  it('logs no source IP address, sub claim, other header or body (CD5)', () => {
    const format = (stageProperties()['AccessLogSettings'] as { Format: string }).Format;
    for (const forbidden of ['identity', 'sourceIp', 'claims.sub', 'header', 'body', 'userAgent']) {
      expect(format).not.toContain(forbidden);
    }
  });

  it('writes to a log group of its own, kept 14 days', () => {
    const [logGroupLogicalId] = Object.keys(template.findResources('AWS::Logs::LogGroup'));
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: 'demo-stub-api-access',
      RetentionInDays: 14,
    });
    expect(
      (stageProperties()['AccessLogSettings'] as { DestinationArn: unknown }).DestinationArn,
    ).toEqual({ 'Fn::GetAtt': [logGroupLogicalId, 'Arn'] });
  });
});

describe('alarms (§5.5, EU13)', () => {
  function alarm(alarmName: string): Record<string, unknown> {
    const found = resources('AWS::CloudWatch::Alarm').find(
      (candidate) => candidate.Properties['AlarmName'] === alarmName,
    );
    if (found === undefined) {
      throw new Error(`no alarm ${alarmName}`);
    }
    return found.Properties;
  }

  it('are exactly the four of §5.5, each on the alarm topic, missing data not breaching', () => {
    expect(
      resources('AWS::CloudWatch::Alarm')
        .map((candidate) => candidate.Properties['AlarmName'])
        .sort(),
    ).toEqual([
      'demo-stub-api-4xx-spike',
      'demo-stub-api-5xx',
      'demo-stub-api-read-latency-p95',
      'demo-stub-api-throttled',
    ]);
    for (const candidate of resources('AWS::CloudWatch::Alarm')) {
      expect(candidate.Properties).toMatchObject({
        AlarmActions: [{ Ref: alarmTopicLogicalId }],
        ComparisonOperator: 'GreaterThanThreshold',
        TreatMissingData: 'notBreaching',
      });
    }
  });

  it('raises Api5xx above 5 server errors in 5 minutes', () => {
    expect(alarm('demo-stub-api-5xx')).toMatchObject({
      Namespace: 'AWS/ApiGateway',
      MetricName: '5xx',
      Statistic: 'Sum',
      Period: 300,
      Threshold: 5,
      EvaluationPeriods: 1,
    });
  });

  it('raises Api4xxSpike above 20 per cent client errors over 10 minutes', () => {
    const spike = alarm('demo-stub-api-4xx-spike');
    expect(spike).toMatchObject({ Threshold: 20, EvaluationPeriods: 1 });
    const metrics = spike['Metrics'] as {
      Expression?: string;
      MetricStat?: { Metric: { MetricName: string }; Period: number; Stat: string };
    }[];
    const expression = metrics.find((metric) => metric.Expression !== undefined)?.Expression;
    expect(expression).toBe('100 * clientErrors / requests');
    expect(
      metrics
        .filter((metric) => metric.MetricStat !== undefined)
        .map((metric) => [
          metric.MetricStat?.Metric.MetricName,
          metric.MetricStat?.Period,
          metric.MetricStat?.Stat,
        ])
        .sort(),
    ).toEqual([
      ['4xx', 600, 'Sum'],
      ['Count', 600, 'Sum'],
    ]);
  });

  it('raises ApiReadLatencyP95 above 3,000 ms for 3 of 5 minutes, on the read route', () => {
    const latency = alarm('demo-stub-api-read-latency-p95');
    expect(latency).toMatchObject({
      Namespace: 'AWS/ApiGateway',
      MetricName: 'Latency',
      ExtendedStatistic: 'p95',
      Period: 60,
      Threshold: 3000,
      EvaluationPeriods: 5,
      DatapointsToAlarm: 3,
    });
    const dimensions = latency['Dimensions'] as { Name: string; Value: unknown }[];
    expect(dimensions.map((dimension) => dimension.Name).sort()).toEqual([
      'ApiId',
      'Method',
      'Resource',
      'Stage',
    ]);
    expect(dimensions).toEqual(
      expect.arrayContaining([
        { Name: 'Method', Value: 'GET' },
        { Name: 'Resource', Value: '/v1/records/{recordId}' },
        { Name: 'Stage', Value: '$default' },
      ]),
    );
  });

  it('raises ApiThrottled above 50 responses with status 429 in 5 minutes, from the access log', () => {
    expect(alarm('demo-stub-api-throttled')).toMatchObject({
      Namespace: 'Demo/stub',
      MetricName: 'ApiThrottled',
      Statistic: 'Sum',
      Period: 300,
      Threshold: 50,
      EvaluationPeriods: 1,
    });
    const [logGroupLogicalId] = Object.keys(template.findResources('AWS::Logs::LogGroup'));
    expect(resources('AWS::Logs::MetricFilter').map((filter) => filter.Properties)).toEqual([
      {
        LogGroupName: { Ref: logGroupLogicalId },
        FilterPattern: '{ $.status = "429" }',
        MetricTransformations: [
          { MetricNamespace: 'Demo/stub', MetricName: 'ApiThrottled', MetricValue: '1' },
        ],
      },
    ]);
  });
});
