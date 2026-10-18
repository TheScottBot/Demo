// Spec 00 §3.1: the version carried by every input that crosses a boundary.
// A mismatch is refused and counted by whoever reads the input.
export const contractVersions = {
  publicApiPathPrefix: '/v1',
  providerContractVersion: '1',
  queueMessageVersion: 1,
  journalSchemaVersion: 1,
} as const;

// An exact comparison: a provider that sends `1.0` or ` 1` has not agreed to
// this contract, however close the value looks.
export function isProviderContractVersionSupported(headerValue: string | undefined): boolean {
  return headerValue === contractVersions.providerContractVersion;
}
