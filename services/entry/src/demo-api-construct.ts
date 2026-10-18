import {
  demoResourceName,
  type DemoApiOutputs,
  type DemoApiProperties,
} from '@demo/construct-contracts';
import { httpHeaders, publicRoutes, type PublicRoute } from '@demo/contracts';
import {
  Duration,
  aws_apigatewayv2 as apigatewayv2,
  aws_apigatewayv2_authorizers as authorizers,
  aws_apigatewayv2_integrations as integrations,
  aws_certificatemanager as certificatemanager,
  aws_lambda as lambda,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

// Spec 01 §2 to §4: the single public API. It holds no runtime code (§1):
// the gateway verifies tokens, and the handlers Specs 02 and 03 own do the
// rest. Every route comes from the contract's own route table, so the API
// cannot hold a route the contract does not.

// EU10, adopted by the author on 18 October 2026 (EQ4): above each route's
// function timeout (Spec 02 RU11, Spec 03 WU20), below the gateway's 29
// second limit (EU2).
const integrationTimeouts: Record<PublicRoute['handlerOwner'], Duration> = {
  'spec-02-read-handler': Duration.seconds(6),
  'spec-03-command-handler': Duration.seconds(10),
  'spec-03-status-handler': Duration.seconds(10),
};

function routeMethod(publicRoute: PublicRoute): apigatewayv2.HttpMethod {
  return publicRoute.method === 'GET' ? apigatewayv2.HttpMethod.GET : apigatewayv2.HttpMethod.POST;
}

export class DemoApi extends Construct implements DemoApiOutputs {
  readonly baseUrl: string;

  constructor(scope: Construct, constructId: string, properties: DemoApiProperties) {
    super(scope, constructId);
    if (properties.identityProvider.kind === 'demo-user-pool') {
      // ED1 chose the demo pool; EE2 builds it, so until then it is refused
      // rather than wired to a placeholder issuer.
      throw new Error('demo-user-pool-not-built: Spec 01 EE2 builds the demo user pool');
    }

    const httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
      apiName: demoResourceName(properties.stage, 'api'),
      // §2.1: the default stage, deployed automatically.
      createDefaultStage: true,
      disableExecuteApiEndpoint: properties.customDomain !== undefined,
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
    const jwtAuthorizer = new authorizers.HttpJwtAuthorizer(
      'JwtAuthorizer',
      properties.identityProvider.issuerUrl,
      {
        jwtAudience: [...properties.identityProvider.audiences],
        identitySource: [`$request.header.${httpHeaders.authorization.wireName}`],
      },
    );

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
            timeout: integrationTimeouts[publicRoute.handlerOwner],
          },
        ),
        authorizer: jwtAuthorizer,
      });
    }

    // With a custom domain the default endpoint is off (§2.1), so the domain
    // is the API's address.
    this.baseUrl =
      properties.customDomain === undefined
        ? httpApi.apiEndpoint
        : `https://${properties.customDomain.domainName}`;
  }
}
