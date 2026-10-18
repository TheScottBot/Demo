import {
  demoMetricsNamespace,
  demoResourceName,
  type DemoApiOutputs,
  type DemoApiProperties,
} from '@demo/construct-contracts';
import { httpHeaders, publicRoutes, type PublicRoute } from '@demo/contracts';
import {
  Duration,
  RemovalPolicy,
  aws_apigatewayv2 as apigatewayv2,
  aws_apigatewayv2_authorizers as authorizers,
  aws_apigatewayv2_integrations as integrations,
  aws_certificatemanager as certificatemanager,
  aws_cloudwatch as cloudwatch,
  aws_cloudwatch_actions as cloudwatchActions,
  aws_lambda as lambda,
  aws_logs as logs,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  accessLogRetentionDays,
  alarmThresholds,
  corsAllowedHeaders,
  corsExposedHeaders,
  corsMaximumAgeSeconds,
  integrationTimeoutSeconds,
  routeThrottles,
} from './demo-api-settings';
import { DemoUserPool } from './demo-user-pool-construct';

// Spec 01 §2 to §5: the single public API. It holds no runtime code (§1):
// the gateway verifies tokens, and the handlers Specs 02 and 03 own do the
// rest. Every route comes from the contract's own route table, so the API
// cannot hold a route the contract does not.

// §5.4 and EU9: exactly these fields. The source IP address, the sub claim,
// every other header and every body are left out (Spec 00 CD5).
const accessLogFormat = JSON.stringify({
  requestId: '$context.requestId',
  routeKey: '$context.routeKey',
  status: '$context.status',
  responseLatency: '$context.responseLatency',
  integrationLatency: '$context.integrationLatency',
  integrationErrorMessage: '$context.integrationErrorMessage',
  authorizerError: '$context.authorizer.error',
  tenantId: '$context.authorizer.claims.tenant_id',
});

function routeMethod(publicRoute: PublicRoute): apigatewayv2.HttpMethod {
  return publicRoute.method === 'GET' ? apigatewayv2.HttpMethod.GET : apigatewayv2.HttpMethod.POST;
}

function routeKey(publicRoute: PublicRoute): string {
  return `${publicRoute.method} ${publicRoute.path}`;
}

export class DemoApi extends Construct implements DemoApiOutputs {
  readonly baseUrl: string;

  constructor(scope: Construct, constructId: string, properties: DemoApiProperties) {
    super(scope, constructId);
    // §5.3: a wildcard origin only in dev.
    if (properties.stage !== 'dev' && properties.corsAllowedOrigins.includes('*')) {
      throw new Error('cors-wildcard-outside-dev: §5.3 allows a wildcard origin only in dev');
    }
    // ED1: the demo pool (§4.2), or an external issuer's own settings.
    const issuer =
      properties.identityProvider.kind === 'demo-user-pool'
        ? new DemoUserPool(this, 'DemoUserPool', { stage: properties.stage })
        : properties.identityProvider;

    const httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
      apiName: demoResourceName(properties.stage, 'api'),
      // §2.1: the default stage, deployed automatically.
      createDefaultStage: true,
      disableExecuteApiEndpoint: properties.customDomain !== undefined,
      // §5.3, every header list from the contract (EU12 for the maximum age).
      corsPreflight: {
        allowOrigins: [...properties.corsAllowedOrigins],
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: [...corsAllowedHeaders],
        exposeHeaders: [...corsExposedHeaders],
        maxAge: Duration.seconds(corsMaximumAgeSeconds),
      },
      ...(properties.customDomain === undefined
        ? {}
        : {
            defaultDomainMapping: {
              domainName: new apigatewayv2.DomainName(this, 'DomainName', {
                domainName: properties.customDomain.domainName,
                certificate: certificatemanager.Certificate.fromCertificateArn(
                  this,
                  'Certificate',
                  properties.customDomain.certificateArn,
                ),
              }),
            },
          }),
    });

    // §4.1: the Authorization header, the issuer and audiences ED1 sets, and
    // no route scopes, so a missing scope is requireScope's to answer with a
    // problem document.
    const jwtAuthorizer = new authorizers.HttpJwtAuthorizer('JwtAuthorizer', issuer.issuerUrl, {
      jwtAudience: [...issuer.audiences],
      identitySource: [`$request.header.${httpHeaders.authorization.wireName}`],
    });

    const handlerFor: Record<PublicRoute['handlerOwner'], lambda.IFunction> = {
      'spec-02-read-handler': properties.readHandler,
      'spec-03-command-handler': properties.commandHandler,
      'spec-03-status-handler': properties.statusHandler,
    };
    // §2.2: three routes, three functions; no default route, so any other
    // path is the gateway's own 404 (EU3). The integration grants its own
    // invoke permission (EU4).
    for (const publicRoute of publicRoutes) {
      httpApi.addRoutes({
        path: publicRoute.path,
        methods: [routeMethod(publicRoute)],
        integration: new integrations.HttpLambdaIntegration(
          `${publicRoute.handlerOwner}-integration`,
          handlerFor[publicRoute.handlerOwner],
          {
            payloadFormatVersion: apigatewayv2.PayloadFormatVersion.VERSION_2_0,
            timeout: Duration.seconds(integrationTimeoutSeconds[publicRoute.handlerOwner]),
          },
        ),
        authorizer: jwtAuthorizer,
      });
    }

    // §5.1, §5.4 and §5.5 sit on the default stage, which only the L1
    // resource configures route by route (EU7).
    const defaultStage = httpApi.defaultStage?.node.defaultChild;
    if (!(defaultStage instanceof apigatewayv2.CfnStage)) {
      throw new Error('default-stage-missing');
    }
    const readRoute = publicRoutes.find(
      (publicRoute) => publicRoute.handlerOwner === 'spec-02-read-handler',
    );
    if (readRoute === undefined) {
      throw new Error('read-route-missing');
    }
    // §5.1: a rate and burst on each route (EU11). The read route also writes
    // the route level metrics its latency alarm reads. RouteSettings is a free
    // form map, which the CDK passes through unconverted, so its keys are
    // written as CloudFormation names them.
    defaultStage.routeSettings = Object.fromEntries(
      publicRoutes.map((publicRoute) => [
        routeKey(publicRoute),
        {
          ThrottlingRateLimit: routeThrottles[publicRoute.handlerOwner].rate,
          ThrottlingBurstLimit: routeThrottles[publicRoute.handlerOwner].burst,
          ...(publicRoute === readRoute ? { DetailedMetricsEnabled: true } : {}),
        },
      ]),
    );

    // §5.4: structured access logs, kept for EU12.
    const accessLogGroup = new logs.LogGroup(this, 'AccessLogGroup', {
      logGroupName: demoResourceName(properties.stage, 'api-access'),
      retention: accessLogRetentionDays,
      // Synthetic data only (Spec 00 §2.3).
      removalPolicy: RemovalPolicy.DESTROY,
    });
    defaultStage.accessLogSettings = {
      destinationArn: accessLogGroup.logGroupArn,
      format: accessLogFormat,
    };

    // §5.5: the alarms, every one to the family's alarm topic (Spec 00 §5.1).
    const alarmAction = new cloudwatchActions.SnsAction(properties.alarmTopic);
    const alarmOn = (
      alarmComponent: string,
      metric: cloudwatch.IMetric,
      threshold: number,
      evaluationPeriods = 1,
      datapointsToAlarm = evaluationPeriods,
    ): void => {
      new cloudwatch.Alarm(this, `Alarm-${alarmComponent}`, {
        alarmName: demoResourceName(properties.stage, alarmComponent),
        metric,
        threshold,
        evaluationPeriods,
        datapointsToAlarm,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(alarmAction);
    };
    const fiveMinutes = Duration.minutes(5);
    const tenMinutes = Duration.minutes(10);
    alarmOn(
      'api-5xx',
      httpApi.metricServerError({ period: fiveMinutes, statistic: 'Sum' }),
      alarmThresholds.serverErrorsInFiveMinutes,
    );
    alarmOn(
      'api-4xx-spike',
      new cloudwatch.MathExpression({
        expression: '100 * clientErrors / requests',
        usingMetrics: {
          clientErrors: httpApi.metricClientError({ period: tenMinutes, statistic: 'Sum' }),
          requests: httpApi.metricCount({ period: tenMinutes, statistic: 'Sum' }),
        },
        period: tenMinutes,
      }),
      alarmThresholds.clientErrorPercentOverTenMinutes,
    );
    alarmOn(
      'api-read-latency-p95',
      new cloudwatch.Metric({
        namespace: 'AWS/ApiGateway',
        metricName: 'Latency',
        statistic: 'p95',
        period: Duration.minutes(1),
        // The route level dimensions, sent only with detailed metrics on. The
        // value Resource takes for an HTTP API route is unverified until a
        // stage is deployed (IMPLEMENTATION_DEVIATIONS.md entry 3).
        dimensionsMap: {
          ApiId: httpApi.apiId,
          Stage: '$default',
          Method: readRoute.method,
          Resource: readRoute.path,
        },
      }),
      alarmThresholds.readLatencyP95Milliseconds,
      alarmThresholds.readLatencyEvaluatedMinutes,
      alarmThresholds.readLatencyBreachingMinutes,
    );
    // §5.1 and §5.5: throttled requests, counted from the access log.
    const throttledMetric = new logs.MetricFilter(this, 'ThrottledFilter', {
      logGroup: accessLogGroup,
      filterPattern: logs.FilterPattern.stringValue('$.status', '=', '429'),
      metricNamespace: demoMetricsNamespace(properties.stage),
      metricName: 'ApiThrottled',
      metricValue: '1',
    }).metric({ period: fiveMinutes, statistic: 'Sum' });
    alarmOn('api-throttled', throttledMetric, alarmThresholds.throttledInFiveMinutes);

    // With a custom domain the default endpoint is off (§2.1), so the domain
    // is the API's address.
    this.baseUrl =
      properties.customDomain === undefined
        ? httpApi.apiEndpoint
        : `https://${properties.customDomain.domainName}`;
  }
}
