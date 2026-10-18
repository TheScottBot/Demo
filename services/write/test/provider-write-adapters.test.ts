// Spec 03 §6.5 and WE4: each provider file sets only its providerId, its base
// URL variable and its secret; the environment wires the rest.
import { describe, expect, it } from 'vitest';
import { createConfiguredWriteAdapters } from '../src/adapters/write-adapters';
import { providerAWriteAdapterSettings } from '../src/adapters/provider-a-write-adapter';
import { providerBWriteAdapterSettings } from '../src/adapters/provider-b-write-adapter';
import { providerCWriteAdapterSettings } from '../src/adapters/provider-c-write-adapter';

const environment = Object.fromEntries(
  ['A', 'B', 'C'].flatMap((letter) => [
    [
      `PROVIDER_${letter}_BASE_URL`,
      `https://provider-${letter.toLowerCase()}.providers.example.test`,
    ],
    [
      `PROVIDER_${letter}_SECRET_ARN`,
      `arn:aws:secretsmanager:eu-west-2:000000000000:secret:demo/dev/providers/provider-${letter.toLowerCase()}-AbCdEf`,
    ],
  ]),
);

describe('the provider write adapters', () => {
  it('name only their provider, base URL variable and secret', () => {
    expect([
      providerAWriteAdapterSettings,
      providerBWriteAdapterSettings,
      providerCWriteAdapterSettings,
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

  it('are built from the environment in routing table order, reading no secret until used', () => {
    const secretsRead: string[] = [];
    const adapters = createConfiguredWriteAdapters(
      environment,
      (secretArn) => {
        secretsRead.push(secretArn);
        return Promise.resolve('synthetic-key');
      },
      { countRetryAfterIgnored: () => undefined },
    );
    expect(adapters.map((adapter) => adapter.providerId)).toEqual([
      'provider-a',
      'provider-b',
      'provider-c',
    ]);
    expect(secretsRead).toEqual([]);
  });

  it('refuse an environment without a provider, or with plain http to another host', () => {
    const readSecret = () => Promise.resolve('synthetic-key');
    const metrics = { countRetryAfterIgnored: () => undefined };
    expect(() =>
      createConfiguredWriteAdapters(
        { ...environment, PROVIDER_B_BASE_URL: undefined },
        readSecret,
        metrics,
      ),
    ).toThrow();
    expect(() =>
      createConfiguredWriteAdapters(
        { ...environment, PROVIDER_C_BASE_URL: 'http://provider-c.example.test' },
        readSecret,
        metrics,
      ),
    ).toThrow();
  });
});
