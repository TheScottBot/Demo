// Spec 00: the one CDK app. Changed only in a Spec 00 phase (§2.2).
import { App } from 'aws-cdk-lib';
import { buildDemoPlatform } from '../lib/demo-platform';

const app = new App();
buildDemoPlatform(app);
app.synth();
