import { fileURLToPath } from 'node:url';
import {
  createDemoNodejsFunction,
  demoMetricsNamespace,
  demoResourceName,
  type ReadPathOutputs,
  type ReadPathProperties,
} from '@demo/construct-contracts';
import { providerIdentifiers } from '@demo/contracts';
import {
  Duration,
  aws_cloudwatch as cloudwatch,
  aws_cloudwatch_actions as cloudwatchActions,
  aws_iam as iam,
  aws_lambda as lambda,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { providerAReadAdapterSettings } from './adapters/provider-a-read-adapter';
import { providerBReadAdapterSettings } from './adapters/provider-b-read-adapter';
import { providerCReadAdapterSettings } from './adapters/provider-c-read-adapter';
import { readPathSettings } from './read-path-settings';

// Spec 02 §7: the read path's one function, implementing the Spec 00 §3.11
// interfaces exactly. The tuning values are constants here, as §7 requires.

const readHandlerEntryPath = fileURLToPath(new URL('./read-handler-entry.ts', import.meta.url));

// RU10 to RU14, adopted by the author on 18 October 2026 (RQ3).
const readFunctionSettings = {
  memoryMegabytes: 512,
  timeout: Duration.seconds(5),
  reservedConcurrency: 100,
  // In demo only; it has a cost.
  demoProvisionedConcurrency: 2,
  alarmPeriod: Duration.minutes(5),
  providerTimeoutRatePercent: 10,
} as const;

const providerSettings = [
  providerAReadAdapterSettings,
  providerBReadAdapterSettings,
  providerCReadAdapterSettings,
];

export class ReadPath extends Construct implements ReadPathOutputs {
  readonly readHandler: lambda.IFunction;

  constructor(scope: Construct, constructId: string, properties: ReadPathProperties) {
    super(scope, constructId);
    // §6, RD1: the switch exists and the cache does not. Enabling it needs the
    // RD1 decision named, and even then fails: RE7, which builds the cache, is
    // unscheduled.
    if (properties.readCache?.enabled === true) {
      if (properties.readCache.approvalReference === undefined) {
        throw new Error(
          'read-cache-needs-approval-reference: name the RD1 decision that enables it',
        );
      }
      throw new Error('read-cache-not-built: RE7 is unscheduled under RD1');
    }
    const providerConnections = providerIdentifiers.map((providerId) =>
      properties.providers.filter((connection) => connection.providerId === providerId),
    );
    if (
      properties.providers.length !== providerIdentifiers.length ||
      providerConnections.some((matchingConnections) => matchingConnections.length !== 1)
    ) {
      throw new Error('read-path-needs-each-provider-once');
    }
    const connectionFor = (providerId: string) => {
      const connection = properties.providers.find(
        (candidate) => candidate.providerId === providerId,
      );
      if (connection === undefined) {
        throw new Error('read-path-needs-each-provider-once');
      }
      return connection;
    };

    const readFunction = createDemoNodejsFunction(this, 'ReadFunction', {
      stage: properties.stage,
      component: 'read',
      entry: readHandlerEntryPath,
      environment: {
        DEMO_STAGE: properties.stage,
        PROVIDER_TIMEOUT_MILLISECONDS: String(readPathSettings.providerTimeoutMilliseconds),
        FAN_OUT_BUDGET_MILLISECONDS: String(readPathSettings.fanOutBudgetMilliseconds),
        ...Object.fromEntries(
          providerSettings.flatMap((settings) => [
            [settings.baseUrlVariable, connectionFor(settings.providerId).baseUrl],
            // The secret's ARN, never its value (Spec 00 §2.3).
            [settings.secretArnVariable, connectionFor(settings.providerId).secretArn],
          ]),
        ),
      },
      memorySize: readFunctionSettings.memoryMegabytes,
      timeout: readFunctionSettings.timeout,
      activeTracing: true,
    });
    // The helper sets nothing a stream tunes; reserved concurrency is set on
    // the underlying resource.
    (readFunction.node.defaultChild as lambda.CfnFunction).reservedConcurrentExecutions =
      readFunctionSettings.reservedConcurrency;
    // §7: the three provider secrets, and nothing else.
    readFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: providerSettings.map((settings) => connectionFor(settings.providerId).secretArn),
      }),
    );

    const liveAlias = new lambda.Alias(this, 'LiveAlias', {
      aliasName: 'live',
      version: readFunction.currentVersion,
      ...(properties.stage === 'demo'
        ? { provisionedConcurrentExecutions: readFunctionSettings.demoProvisionedConcurrency }
        : {}),
    });
    this.readHandler = liveAlias;

    // §8 alarms, every one to the family's alarm topic (Spec 00 §5.1).
    const namespace = demoMetricsNamespace(properties.stage);
    const readMetric = (
      metricName: string,
      statistic: string,
      dimensions: Record<string, string> = {},
    ) =>
      new cloudwatch.Metric({
        namespace,
        metricName,
        statistic,
        period: readFunctionSettings.alarmPeriod,
        dimensionsMap: { service: 'read', ...dimensions },
      });
    const alarmAction = new cloudwatchActions.SnsAction(properties.alarmTopic);
    const alarmOn = (
      alarmComponent: string,
      metric: cloudwatch.Metric | cloudwatch.MathExpression,
      threshold: number,
    ) => {
      metric
        .createAlarm(this, `Alarm-${alarmComponent}`, {
          alarmName: demoResourceName(properties.stage, alarmComponent),
          threshold,
          evaluationPeriods: 1,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        })
        .addAlarmAction(alarmAction);
    };

    for (const providerId of providerIdentifiers) {
      // One provider's timeouts as a share of its calls: every call records
      // one ProviderLatency sample, so its sample count is the call count.
      alarmOn(
        `read-provider-timeout-rate-${providerId}`,
        new cloudwatch.MathExpression({
          expression: 'IF(calls > 0, 100 * timeouts / calls, 0)',
          usingMetrics: {
            timeouts: readMetric('ProviderOutcome', 'Sum', { providerId, status: 'timeout' }),
            calls: readMetric('ProviderLatency', 'SampleCount', { providerId }),
          },
          period: readFunctionSettings.alarmPeriod,
        }),
        readFunctionSettings.providerTimeoutRatePercent,
      );
    }
    alarmOn(
      'read-provider-version-mismatch',
      new cloudwatch.MathExpression({
        expression: 'FILL(mismatchA, 0) + FILL(mismatchB, 0) + FILL(mismatchC, 0)',
        usingMetrics: {
          mismatchA: readMetric('ProviderOutcome', 'Sum', {
            providerId: 'provider-a',
            status: 'error',
            errorReason: 'version-mismatch',
          }),
          mismatchB: readMetric('ProviderOutcome', 'Sum', {
            providerId: 'provider-b',
            status: 'error',
            errorReason: 'version-mismatch',
          }),
          mismatchC: readMetric('ProviderOutcome', 'Sum', {
            providerId: 'provider-c',
            status: 'error',
            errorReason: 'version-mismatch',
          }),
        },
        period: readFunctionSettings.alarmPeriod,
      }),
      0,
    );
    alarmOn('read-all-sources-unavailable', readMetric('ReadAllSourcesUnavailable', 'Sum'), 0);
    alarmOn(
      'read-function-errors',
      readFunction.metricErrors({ period: readFunctionSettings.alarmPeriod, statistic: 'Sum' }),
      0,
    );
  }
}
