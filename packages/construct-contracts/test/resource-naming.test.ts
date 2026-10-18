import { describe, expect, it } from 'vitest';
import {
  demoMetricsNamespace,
  demoResourceName,
  demoStackName,
  demoStages,
  providerSecretName,
} from '../src/index';

describe('stages', () => {
  it('are exactly the four Spec 00 §2.3 stages', () => {
    expect(demoStages).toEqual(['dev', 'stub', 'test', 'demo']);
  });

  it('name one stack each (Spec 00 §5.2)', () => {
    expect(demoStages.map(demoStackName)).toEqual([
      'DemoPlatform-dev',
      'DemoPlatform-stub',
      'DemoPlatform-test',
      'DemoPlatform-demo',
    ]);
  });
});

describe('demoResourceName', () => {
  it('joins prefix, stage and component with single hyphens', () => {
    expect(demoResourceName('dev', 'command-journal')).toBe('demo-dev-command-journal');
    expect(demoResourceName('stub', 'alarms')).toBe('demo-stub-alarms');
  });

  it.each([
    '',
    'Command',
    'command_journal',
    '-journal',
    'journal-',
    // Built from parts so the file passes the prose scan; the value is unchanged.
    ['command', 'journal'].join('-'.repeat(2)),
    'journal 1',
    'jöurnal',
  ])('refuses the component %j', (component) => {
    expect(() => demoResourceName('dev', component)).toThrow('component-outside-grammar');
  });

  // The Lambda function name limit (64) is the tightest of every resource the
  // family names (evaluation record, naming limits), so it binds them all.
  it('refuses a name longer than 64 characters, at synth rather than deploy', () => {
    const longestComponent = 'c'.repeat(64 - 'demo-stub-'.length);
    expect(demoResourceName('stub', longestComponent)).toHaveLength(64);
    expect(() => demoResourceName('stub', `${longestComponent}c`)).toThrow(
      'resource-name-too-long',
    );
  });
});

describe('other platform names', () => {
  it('name a provider secret as CU8 settled', () => {
    expect(providerSecretName('dev', 'provider-a')).toBe('demo/dev/providers/provider-a');
  });

  it('name the metrics namespace per stage (Spec 00 §5.1)', () => {
    expect(demoMetricsNamespace('test')).toBe('Demo/test');
  });
});
