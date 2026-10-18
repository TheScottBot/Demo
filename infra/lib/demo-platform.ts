import {
  StubReadPath,
  StubWritePath,
  demoResourceName,
  demoStackName,
  demoStages,
} from '@demo/construct-contracts';
import { Stack, aws_sns as sns, type App } from 'aws-cdk-lib';

// Spec 00 §5.2: one stack per stage, every construct wired through the §3.11
// interfaces alone.
//
// As of CE5 every stage holds the stubs; CE6 replaces them with the real
// ReadPath and WritePath outside the stub stage. DemoApi (Spec 01 EE1) is not
// wired yet: EE1 depends on CE5, so it cannot exist before it. Wiring it here
// is a Spec 00 change to make once EE1 is done (tracked in
// docs/IMPLEMENTATION_TRACKER.md).
export function buildDemoPlatform(app: App): Stack[] {
  return demoStages.map((stage) => {
    const stack = new Stack(app, demoStackName(stage), { stackName: demoStackName(stage) });
    // Spec 00 §5.1: every alarm in the family goes to this one topic.
    const alarmTopic = new sns.Topic(stack, 'AlarmTopic', {
      topicName: demoResourceName(stage, 'alarms'),
    });
    // No provider connections yet: the mock providers (CE4) do not exist, and
    // the stubs call no provider.
    new StubReadPath(stack, 'ReadPath', { stage, providers: [], alarmTopic });
    new StubWritePath(stack, 'WritePath', {
      stage,
      providers: [],
      alarmTopic,
      relayEnabled: stage !== 'test',
    });
    return stack;
  });
}
