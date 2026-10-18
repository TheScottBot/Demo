import {
  StubReadPath,
  StubWritePath,
  demoResourceName,
  demoStackName,
  demoStages,
} from '@demo/construct-contracts';
import { DemoApi } from '@demo/entry';
import { Stack, aws_sns as sns, type App } from 'aws-cdk-lib';

// Spec 00 §5.2: one stack per stage, every construct wired through the §3.11
// interfaces alone.
//
// As of CE5 every stage holds the stubs; CE6 replaces them with the real
// ReadPath and WritePath outside the stub stage. DemoApi (Spec 01) is wired
// since EE2 gave it the demo user pool (CQ9, ED1).

// Nothing is deployed and no web client exists (CQ6), so every stage allows
// only a client served locally. A deployed stage names its own origins; a
// wildcard is refused outside dev (Spec 01 §5.3).
const corsAllowedOrigins = ['http://localhost:3000'];

export function buildDemoPlatform(app: App): Stack[] {
  return demoStages.map((stage) => {
    const stack = new Stack(app, demoStackName(stage), { stackName: demoStackName(stage) });
    // Spec 00 §5.1: every alarm in the family goes to this one topic.
    const alarmTopic = new sns.Topic(stack, 'AlarmTopic', {
      topicName: demoResourceName(stage, 'alarms'),
    });
    // No provider connections yet: the mock providers (CE4) do not exist, and
    // the stubs call no provider.
    const readPath = new StubReadPath(stack, 'ReadPath', { stage, providers: [], alarmTopic });
    const writePath = new StubWritePath(stack, 'WritePath', {
      stage,
      providers: [],
      alarmTopic,
      relayEnabled: stage !== 'test',
    });
    new DemoApi(stack, 'DemoApi', {
      stage,
      readHandler: readPath.readHandler,
      commandHandler: writePath.commandHandler,
      statusHandler: writePath.statusHandler,
      identityProvider: { kind: 'demo-user-pool' },
      corsAllowedOrigins,
      alarmTopic,
    });
    return stack;
  });
}
