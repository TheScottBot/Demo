import { isWithinByteBound } from './bounds';

export type JsonBodyParse =
  | { readonly outcome: 'parsed'; readonly value: unknown }
  | { readonly outcome: 'too-large' }
  | { readonly outcome: 'not-json' };

// The bound is checked on the text as received, before JSON.parse sees any of
// it (datum 0.10), and the bound is the caller's contract value, never one
// taken from the input.
export function parseJsonBodyWithinBound(rawBody: string, maximumBytes: number): JsonBodyParse {
  if (!isWithinByteBound(rawBody, maximumBytes)) {
    return { outcome: 'too-large' };
  }
  try {
    return { outcome: 'parsed', value: JSON.parse(rawBody) as unknown };
  } catch {
    return { outcome: 'not-json' };
  }
}
