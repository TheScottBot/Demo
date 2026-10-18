// Spec 02 §3.2: each provider file sets only its providerId, its base URL
// variable and its secret; everything else is the shared HttpReadAdapter.
import { describe, expect, it } from 'vitest';
import {
  createConfiguredReadAdapters,
  providerAReadAdapterSettings,
  providerBReadAdapterSettings,
  providerCReadAdapterSettings,
} from '../src/index';

const completeEnvironment = {
  PROVIDER_A_BASE_URL: 'https://provider-a.providers.example.test',
  PROVIDER_A_SECRET_ARN:
    'arn:aws:secretsmanager:eu-west-2:000000000000:secret:demo/dev/providers/provider-a-AbCdEf',
  PROVIDER_B_BASE_URL: 'https://provider-b.providers.example.test',
  PROVIDER_B_SECRET_ARN:
    'arn:aws:secretsmanager:eu-west-2:000000000000:secret:demo/dev/providers/provider-b-AbCdEf',
  PROVIDER_C_BASE_URL: 'https://provider-c.providers.example.test',
  PROVIDER_C_SECRET_ARN:
    'arn:aws:secretsmanager:eu-west-2:000000000000:secret:demo/dev/providers/provider-c-AbCdEf',
};

describe('the provider adapter settings', () => {
  it('name each provider, its base URL variable and its secret variable', () => {
    expect([
      providerAReadAdapterSettings,
      providerBReadAdapterSettings,
      providerCReadAdapterSettings,
    ]).toEqual([
      {
        providerId: 'provider-a',
        baseUrlVariable: 'PROVIDER_A_BASE_URL',
        secretArnVariable: 'PROVIDER_A_SECRET_ARN',
      },
      {
        providerId: 'provider-b',
        baseUrlVariable: 'PROVIDER_B_BASE_URL',
        secretArnVariable: 'PROVIDER_B_SECRET_ARN',
      },
      {
        providerId: 'provider-c',
        baseUrlVariable: 'PROVIDER_C_BASE_URL',
        secretArnVariable: 'PROVIDER_C_SECRET_ARN',
      },
    ]);
  });
});

describe('createConfiguredReadAdapters', () => {
  it('builds one adapter per provider, in routing table order, from the environment', () => {
    const secretArnsRead: string[] = [];
    const adapters = createConfiguredReadAdapters(completeEnvironment, (secretArn) => {
      secretArnsRead.push(secretArn);
      return Promise.resolve('synthetic-key');
    });
    expect(adapters.map((adapter) => adapter.providerId)).toEqual([
      'provider-a',
      'provider-b',
      'provider-c',
    ]);
    // Secrets are read lazily, on first use, not when the adapters are built.
    expect(secretArnsRead).toEqual([]);
  });

  // Spec 00 §2.3: a missing or invalid variable fails the cold start.
  it.each([
    ['a missing base URL', { ...completeEnvironment, PROVIDER_B_BASE_URL: undefined }],
    [
      'a base URL that is not https',
      { ...completeEnvironment, PROVIDER_A_BASE_URL: 'ftp://provider-a.example.test' },
    ],
    ['a missing secret ARN', { ...completeEnvironment, PROVIDER_C_SECRET_ARN: undefined }],
    [
      'a secret value where an ARN belongs',
      { ...completeEnvironment, PROVIDER_A_SECRET_ARN: 'synthetic-key' },
    ],
  ])('refuses %s', (_caseName, environment) => {
    expect(() => createConfiguredReadAdapters(environment, () => Promise.resolve('key'))).toThrow();
  });

  it('allows a loopback http base URL, for the local mock providers (CQ6)', () => {
    expect(() =>
      createConfiguredReadAdapters(
        { ...completeEnvironment, PROVIDER_A_BASE_URL: 'http://127.0.0.1:4101' },
        () => Promise.resolve('key'),
      ),
    ).not.toThrow();
  });
});
