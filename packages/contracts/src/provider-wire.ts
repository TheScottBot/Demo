import { z } from 'zod';
import { contractBounds } from './bounds';
import { RecordIdentifierSchema, TimestampSchema } from './grammars';
import { parseJsonBodyWithinBound } from './json-body';
import type { ProviderErrorReason } from './read-response';
import { SectionNameSchema, SectionsPartialSchema } from './sections';

// Spec 00 §4.4: bodies on the wire between adapters and providers. The
// provider's version travels only in ETag and If-Match, never in a body, so a
// body that carries one is refused as an unknown key. The replace and append
// request bodies are the §3.7 section shapes and NotesAppendPayload
// themselves, exported from sections.ts.

export const ProviderReadResponseBodySchema = z.strictObject({
  recordId: RecordIdentifierSchema,
  updatedAt: TimestampSchema,
  sections: SectionsPartialSchema,
});

export const ProviderWriteResponseBodySchema = z.strictObject({
  recordId: RecordIdentifierSchema,
  section: SectionNameSchema,
  updatedAt: TimestampSchema,
});

export type ProviderReadResponseBody = z.infer<typeof ProviderReadResponseBodySchema>;
export type ProviderWriteResponseBody = z.infer<typeof ProviderWriteResponseBodySchema>;

export type ProviderBodyParse<Body> =
  | { readonly outcome: 'accepted'; readonly body: Body }
  | {
      readonly outcome: 'rejected';
      readonly errorReason: Extract<ProviderErrorReason, 'body-too-large' | 'schema-invalid'>;
    };

// Adapters stop reading at the bound while the body streams in (Specs 02 and
// 03). This check is the same bound applied again to the text they hand over,
// so a parser called on its own is never unbounded.
function parseProviderBody<Body>(
  bodyText: string,
  bodySchema: z.ZodType<Body>,
): ProviderBodyParse<Body> {
  const jsonBody = parseJsonBodyWithinBound(
    bodyText,
    contractBounds.providerResponseBodyMaximumBytes,
  );
  if (jsonBody.outcome === 'too-large') {
    return { outcome: 'rejected', errorReason: 'body-too-large' };
  }
  if (jsonBody.outcome === 'not-json') {
    return { outcome: 'rejected', errorReason: 'schema-invalid' };
  }
  const parsedBody = bodySchema.safeParse(jsonBody.value);
  return parsedBody.success
    ? { outcome: 'accepted', body: parsedBody.data }
    : { outcome: 'rejected', errorReason: 'schema-invalid' };
}

export function parseProviderReadResponseBody(
  bodyText: string,
): ProviderBodyParse<ProviderReadResponseBody> {
  return parseProviderBody(bodyText, ProviderReadResponseBodySchema);
}

export function parseProviderWriteResponseBody(
  bodyText: string,
): ProviderBodyParse<ProviderWriteResponseBody> {
  return parseProviderBody(bodyText, ProviderWriteResponseBodySchema);
}
