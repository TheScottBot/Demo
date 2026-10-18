import { describe, expect, it } from 'vitest';
import {
  DemoRecordSchema,
  ProviderErrorReasonSchema,
  ProviderOutcomeStatusSchema,
  ReadResponseSchema,
  SourceProvenanceSchema,
} from '../src/index';
import {
  syntheticProviderVersion,
  syntheticRecordIdentifier,
  syntheticSections,
  syntheticTimestamp,
} from './support/synthetic-values';

const okProvenance = {
  providerId: 'provider-a',
  status: 'ok',
  version: syntheticProviderVersion,
  fetchedAt: syntheticTimestamp,
  ttlSeconds: 60,
  latencyMilliseconds: 42,
};

const synthesisedRecord = {
  recordId: syntheticRecordIdentifier,
  sections: { summary: syntheticSections.summary, tasks: syntheticSections.tasks },
  sectionSources: { summary: 'provider-a', tasks: 'provider-a' },
  updatedAt: syntheticTimestamp,
};

describe('provider outcome vocabularies', () => {
  it('match Spec 00 §3.8 exactly', () => {
    expect(ProviderOutcomeStatusSchema.options).toEqual([
      'ok',
      'not-modified',
      'timeout',
      'error',
      'not-found',
    ]);
    expect(ProviderErrorReasonSchema.options).toEqual([
      'transport',
      'http-status',
      'version-mismatch',
      'body-too-large',
      'header-invalid',
      'schema-invalid',
    ]);
  });
});

describe('SourceProvenance', () => {
  it.each([
    ['an ok outcome with its version', okProvenance],
    ['a not-modified outcome', { ...okProvenance, status: 'not-modified' }],
    [
      'an error with its reason',
      { ...okProvenance, status: 'error', errorReason: 'transport', version: undefined },
    ],
    ['a timeout without a version', { ...okProvenance, status: 'timeout', version: undefined }],
  ])('accepts %s', (_caseName, candidate) => {
    expect(SourceProvenanceSchema.safeParse(candidate).success).toBe(true);
  });

  it.each([
    ['an error reason on an ok outcome', { ...okProvenance, errorReason: 'transport' }],
    ['an error without its reason', { ...okProvenance, status: 'error', version: undefined }],
    ['a version on a timeout', { ...okProvenance, status: 'timeout' }],
    ['an unknown provider', { ...okProvenance, providerId: 'provider-z' }],
    ['a negative ttl', { ...okProvenance, ttlSeconds: -1 }],
    ['a fractional ttl', { ...okProvenance, ttlSeconds: 1.5 }],
    ['an unknown key', { ...okProvenance, region: 'eu-west-2' }],
    ['a missing fetchedAt', { ...okProvenance, fetchedAt: undefined }],
  ])('refuses %s', (_caseName, candidate) => {
    expect(SourceProvenanceSchema.safeParse(candidate).success).toBe(false);
  });
});

describe('DemoRecord', () => {
  it('accepts a record holding some sections', () => {
    expect(DemoRecordSchema.safeParse(synthesisedRecord).success).toBe(true);
  });

  it.each([
    ['an unknown section', { ...synthesisedRecord, sections: { attachments: {} } }],
    [
      'an unknown section source',
      { ...synthesisedRecord, sectionSources: { attachments: 'provider-a' } },
    ],
    ['an unknown key', { ...synthesisedRecord, owner: 'someone' }],
    ['a recordId of 129 characters', { ...synthesisedRecord, recordId: 'r'.repeat(129) }],
  ])('refuses %s', (_caseName, candidate) => {
    expect(DemoRecordSchema.safeParse(candidate).success).toBe(false);
  });
});

describe('ReadResponse', () => {
  const readResponse = {
    record: synthesisedRecord,
    partial: false,
    sources: [okProvenance],
    servedFrom: 'live',
  };

  it('accepts a live response', () => {
    expect(ReadResponseSchema.safeParse(readResponse).success).toBe(true);
    expect(
      ReadResponseSchema.safeParse({ ...readResponse, servedFrom: 'server-cache' }).success,
    ).toBe(true);
  });

  it.each([
    ['an unknown origin', { ...readResponse, servedFrom: 'client-cache' }],
    ['a missing partial flag', { ...readResponse, partial: undefined }],
    ['an unknown key', { ...readResponse, cached: true }],
  ])('refuses %s', (_caseName, candidate) => {
    expect(ReadResponseSchema.safeParse(candidate).success).toBe(false);
  });
});
