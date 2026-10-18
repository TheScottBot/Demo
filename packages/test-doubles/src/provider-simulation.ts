import {
  IdempotencyKeySchema,
  NotesAppendPayloadSchema,
  RecordIdentifierSchema,
  SectionNameSchema,
  SectionsPartialSchema,
  TenantIdentifierSchema,
  contractBounds,
  contractVersions,
  faultForRecord,
  formatEntityTag,
  headerValues,
  httpHeaders,
  mockProviderBehaviour,
  parseEntityTag,
  parseJsonBodyWithinBound,
  providerWireStatuses,
  readRequestHeader,
  sectionSchemasBySectionName,
  sectionsOwnedByProvider,
  type MockProviderFault,
  type ProviderIdentifier,
  type SectionName,
} from '@demo/contracts';
import { canonicalJson, computeProviderVersion } from './canonical-version';
import type {
  IdempotencyEntryKey,
  ProviderRecordKey,
  ProviderSimulationStore,
  StoredIdempotencyEntry,
  StoredProviderRecord,
  StoredProviderResponse,
} from './provider-simulation-store';

// One mock provider's behaviour, Spec 00 §4.3 and §4.4 with the CQ7
// decisions, free of any transport. The msw doubles (CE2) and the local mock
// servers (CE4) both wrap this one function, so the two cannot disagree.

export interface ProviderSimulationRequest {
  readonly method: string;
  // The path below the provider's base URL, without a query string.
  readonly path: string;
  // Lower cased names, as both msw and Node.js deliver them.
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly bodyText: string | undefined;
}

export interface ProviderSimulationResponse extends StoredProviderResponse {
  // The transport waits this long before answering (the slow- faults).
  readonly delayMilliseconds: number;
}

export interface ProviderSimulationEnvironment {
  readonly providerId: ProviderIdentifier;
  readonly apiKey: string;
  readonly store: ProviderSimulationStore;
  readonly now: () => Date;
  readonly mintUlid: () => string;
}

type ProviderRoute =
  | { readonly kind: 'read'; readonly recordId: string }
  | { readonly kind: 'replace'; readonly recordId: string; readonly section: string }
  | { readonly kind: 'append'; readonly recordId: string }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'record-identifier-invalid' };

function parseRoute(method: string, path: string): ProviderRoute {
  const segments = path.split('/');
  const [leadingSegment, collectionSegment, recordId, ...remainingSegments] = segments;
  if (leadingSegment !== '' || collectionSegment !== 'records' || recordId === undefined) {
    return { kind: 'unknown' };
  }
  let route: ProviderRoute = { kind: 'unknown' };
  if (method === 'GET' && remainingSegments.length === 0) {
    route = { kind: 'read', recordId };
  } else if (
    method === 'PUT' &&
    remainingSegments.length === 2 &&
    remainingSegments[0] === 'sections' &&
    remainingSegments[1] !== undefined
  ) {
    route = { kind: 'replace', recordId, section: remainingSegments[1] };
  } else if (method === 'POST' && remainingSegments.join('/') === 'sections/notes/entries') {
    route = { kind: 'append', recordId };
  }
  if (route.kind !== 'unknown' && !RecordIdentifierSchema.safeParse(recordId).success) {
    return { kind: 'record-identifier-invalid' };
  }
  return route;
}

function bareResponse(
  status: number,
  headers: Readonly<Record<string, string>> = {},
): StoredProviderResponse {
  // Spec 00 §4.4: the body of a 4xx or 5xx is ignored; the status alone decides.
  return { status, headers, bodyText: undefined };
}

function activeFault(
  recordId: string,
  providerId: ProviderIdentifier,
  operation: 'reads' | 'writes',
): MockProviderFault | undefined {
  const fault = faultForRecord(recordId);
  if (fault === undefined || !fault.providers.includes(providerId)) {
    return undefined;
  }
  return fault.appliesTo === 'reads-and-writes' || fault.appliesTo === operation
    ? fault
    : undefined;
}

const contractHeader = {
  [httpHeaders.providerContract.wireName]: contractVersions.providerContractVersion,
};

function ifNoneMatchMatches(ifNoneMatchValue: string | undefined, entityTag: string): boolean {
  if (ifNoneMatchValue === undefined) {
    return false;
  }
  return ifNoneMatchValue
    .split(',')
    .map((candidateTag) => candidateTag.trim())
    .some((candidateTag) => candidateTag === '*' || candidateTag === entityTag);
}

async function answerRead(
  recordKey: ProviderRecordKey,
  request: ProviderSimulationRequest,
  fault: MockProviderFault | undefined,
  store: ProviderSimulationStore,
): Promise<StoredProviderResponse> {
  const storedRecord = await store.readRecord(recordKey);
  if (storedRecord === undefined) {
    return bareResponse(providerWireStatuses.notHeld);
  }
  const entityTag = formatEntityTag(computeProviderVersion(storedRecord.sections));
  const maxAgeSeconds =
    fault?.effect === 'max-age-beyond-bound'
      ? contractBounds.providerCacheMaxAgeMaximumSeconds + 1
      : mockProviderBehaviour.cacheMaxAgeSeconds;
  const readHeaders: Record<string, string> = {
    [httpHeaders.entityTag.wireName]: entityTag,
    [httpHeaders.cacheControl.wireName]: `max-age=${String(maxAgeSeconds)}`,
    ...(fault?.effect === 'omit-contract-header' ? {} : contractHeader),
  };
  if (ifNoneMatchMatches(readRequestHeader(request.headers, httpHeaders.ifNoneMatch), entityTag)) {
    return { status: providerWireStatuses.notModified, headers: readHeaders, bodyText: undefined };
  }
  const readBody = {
    recordId: recordKey.recordId,
    updatedAt: storedRecord.updatedAt,
    sections: storedRecord.sections,
    // The oversize- fault: one byte past the bound is enough to prove the
    // adapter stops reading, and the padding makes the body schema invalid too.
    ...(fault?.effect === 'oversize-body'
      ? { padding: 'x'.repeat(contractBounds.providerResponseBodyMaximumBytes + 1) }
      : {}),
  };
  return {
    status: providerWireStatuses.readOk,
    headers: { ...readHeaders, [httpHeaders.contentType.wireName]: headerValues.jsonMediaType },
    bodyText: JSON.stringify(readBody),
  };
}

function isOwnedWritableSection(
  providerId: ProviderIdentifier,
  route: Extract<ProviderRoute, { kind: 'replace' | 'append' }>,
): SectionName | undefined {
  const requestedSection = route.kind === 'append' ? 'notes' : route.section;
  const parsedSection = SectionNameSchema.safeParse(requestedSection);
  if (!parsedSection.success || !sectionsOwnedByProvider(providerId).includes(parsedSection.data)) {
    return undefined;
  }
  // Notes take appends only (Spec 00 §4.2).
  if (route.kind === 'replace' && parsedSection.data === 'notes') {
    return undefined;
  }
  return parsedSection.data;
}

function isWithinReplayWindow(entry: StoredIdempotencyEntry, now: Date): boolean {
  const windowEnds =
    Date.parse(entry.firstSeenAt) + mockProviderBehaviour.idempotentReplayWindowSeconds * 1_000;
  return now.getTime() < windowEnds;
}

// Applies a write to the stored sections, or says why it cannot be applied.
function appliedSections(
  storedRecord: StoredProviderRecord,
  section: SectionName,
  payload: unknown,
  environment: ProviderSimulationEnvironment,
): StoredProviderRecord['sections'] | undefined {
  if (section !== 'notes') {
    return SectionsPartialSchema.parse({ ...storedRecord.sections, [section]: payload });
  }
  const { text } = NotesAppendPayloadSchema.parse(payload);
  const appendedSections = SectionsPartialSchema.safeParse({
    ...storedRecord.sections,
    notes: {
      entries: [
        ...(storedRecord.sections.notes?.entries ?? []),
        // CQ7.7: the provider mints the note's identity and time.
        { noteId: environment.mintUlid(), writtenAt: environment.now().toISOString(), text },
      ],
    },
  });
  // A full notes section (§3.7, 100 entries) cannot take another.
  return appendedSections.success ? appendedSections.data : undefined;
}

async function answerWrite(
  route: Extract<ProviderRoute, { kind: 'replace' | 'append' }>,
  request: ProviderSimulationRequest,
  tenantId: string,
  fault: MockProviderFault | undefined,
  environment: ProviderSimulationEnvironment,
): Promise<StoredProviderResponse> {
  const { providerId, store } = environment;
  const section = isOwnedWritableSection(providerId, route);
  if (section === undefined) {
    return bareResponse(providerWireStatuses.notHeld);
  }
  const recordKey = { providerId, tenantId, recordId: route.recordId };
  const storedRecord = await store.readRecord(recordKey);
  // CQ7.5: a provider never creates a record.
  if (storedRecord === undefined) {
    return bareResponse(providerWireStatuses.notHeld);
  }
  const ifMatchValue = readRequestHeader(request.headers, httpHeaders.ifMatch);
  if (ifMatchValue === undefined) {
    return bareResponse(providerWireStatuses.ifMatchRequired);
  }
  const parsedIfMatch = parseEntityTag(ifMatchValue);
  const parsedIdempotencyKey = IdempotencyKeySchema.safeParse(
    readRequestHeader(request.headers, httpHeaders.idempotencyKey),
  );
  if (parsedIfMatch.outcome !== 'valid' || !parsedIdempotencyKey.success) {
    return bareResponse(providerWireStatuses.requestInvalid);
  }
  const jsonBody = parseJsonBodyWithinBound(
    request.bodyText ?? '',
    contractBounds.commandRequestBodyMaximumBytes,
  );
  const payloadSchema =
    section === 'notes' ? NotesAppendPayloadSchema : sectionSchemasBySectionName[section];
  const parsedPayload =
    jsonBody.outcome === 'parsed' ? payloadSchema.safeParse(jsonBody.value) : undefined;
  if (parsedPayload?.success !== true) {
    return bareResponse(providerWireStatuses.requestInvalid);
  }

  const now = environment.now();
  const entryKey: IdempotencyEntryKey = {
    providerId,
    tenantId,
    idempotencyKey: parsedIdempotencyKey.data,
  };
  // The fingerprint leaves out If-Match: a client replaying a request it
  // already sent may have read the new version since.
  const requestFingerprint = `${request.method} ${request.path}\n${canonicalJson(parsedPayload.data)}`;
  const earlierEntry = await store.readIdempotencyEntry(entryKey);
  let entry: StoredIdempotencyEntry;
  if (earlierEntry !== undefined && isWithinReplayWindow(earlierEntry, now)) {
    if (earlierEntry.requestFingerprint !== requestFingerprint) {
      return bareResponse(providerWireStatuses.idempotencyKeyReused);
    }
    if (earlierEntry.completedResponse !== undefined) {
      return earlierEntry.completedResponse;
    }
    entry = earlierEntry;
  } else {
    entry = {
      requestFingerprint,
      firstSeenAt: now.toISOString(),
      attemptsSeen: 0,
      throttled: false,
      completedResponse: undefined,
    };
  }

  switch (fault?.effect) {
    case 'unavailable-for-first-attempts':
      if (entry.attemptsSeen < mockProviderBehaviour.flakyFailedAttemptsPerKey) {
        await store.writeIdempotencyEntry(entryKey, {
          ...entry,
          attemptsSeen: entry.attemptsSeen + 1,
        });
        return bareResponse(providerWireStatuses.unavailable);
      }
      break;
    case 'throttle-once-per-key':
      if (!entry.throttled) {
        await store.writeIdempotencyEntry(entryKey, { ...entry, throttled: true });
        return bareResponse(providerWireStatuses.throttled, {
          [httpHeaders.retryAfter.wireName]: String(
            mockProviderBehaviour.throttleRetryAfterSeconds,
          ),
        });
      }
      break;
    case 'server-error':
      return bareResponse(providerWireStatuses.serverError);
    case 'precondition-failed':
      return bareResponse(providerWireStatuses.preconditionFailed);
    default:
      break;
  }

  if (parsedIfMatch.version !== computeProviderVersion(storedRecord.sections)) {
    return bareResponse(providerWireStatuses.preconditionFailed);
  }
  const updatedSections = appliedSections(storedRecord, section, parsedPayload.data, environment);
  if (updatedSections === undefined) {
    return bareResponse(providerWireStatuses.requestInvalid);
  }
  const updatedAt = now.toISOString();
  await store.writeRecord(recordKey, { sections: updatedSections, updatedAt });
  const completedResponse: StoredProviderResponse = {
    status:
      route.kind === 'append'
        ? providerWireStatuses.appendApplied
        : providerWireStatuses.replaceApplied,
    headers: {
      [httpHeaders.contentType.wireName]: headerValues.jsonMediaType,
      [httpHeaders.entityTag.wireName]: formatEntityTag(computeProviderVersion(updatedSections)),
      ...contractHeader,
    },
    bodyText: JSON.stringify({ recordId: route.recordId, section, updatedAt }),
  };
  await store.writeIdempotencyEntry(entryKey, { ...entry, completedResponse });
  return completedResponse;
}

export async function simulateProviderRequest(
  request: ProviderSimulationRequest,
  environment: ProviderSimulationEnvironment,
): Promise<ProviderSimulationResponse> {
  const immediately = (response: StoredProviderResponse): ProviderSimulationResponse => ({
    ...response,
    delayMilliseconds: 0,
  });
  if (readRequestHeader(request.headers, httpHeaders.providerApiKey) !== environment.apiKey) {
    return immediately(bareResponse(providerWireStatuses.apiKeyRefused));
  }
  const parsedTenant = TenantIdentifierSchema.safeParse(
    readRequestHeader(request.headers, httpHeaders.providerTenant),
  );
  if (!parsedTenant.success) {
    return immediately(bareResponse(providerWireStatuses.requestInvalid));
  }
  const route = parseRoute(request.method, request.path);
  if (route.kind === 'unknown') {
    return immediately(bareResponse(providerWireStatuses.notHeld));
  }
  if (route.kind === 'record-identifier-invalid') {
    return immediately(bareResponse(providerWireStatuses.requestInvalid));
  }
  const fault = activeFault(
    route.recordId,
    environment.providerId,
    route.kind === 'read' ? 'reads' : 'writes',
  );
  const delayMilliseconds =
    fault?.effect === 'delay-response' ? mockProviderBehaviour.slowResponseDelayMilliseconds : 0;
  if (fault?.effect === 'service-unavailable') {
    return { ...bareResponse(providerWireStatuses.unavailable), delayMilliseconds };
  }
  const response =
    route.kind === 'read'
      ? await answerRead(
          {
            providerId: environment.providerId,
            tenantId: parsedTenant.data,
            recordId: route.recordId,
          },
          request,
          fault,
          environment.store,
        )
      : await answerWrite(route, request, parsedTenant.data, fault, environment);
  return { ...response, delayMilliseconds };
}
