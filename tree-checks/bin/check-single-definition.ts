// Spec 00 §2.4 check 3: every contract definition lives in packages/contracts
// and nowhere else.
import * as contracts from '@demo/contracts';
import {
  collectContractTokens,
  findRedeclarations,
  isSingleDefinitionScanned,
} from '../src/single-definition';
import { listRepositoryFiles, readRepositoryFile, reportAndExit } from './repository-files';

const repositoryFiles = listRepositoryFiles();
const contractSourceTexts = repositoryFiles
  .filter((filePath) => filePath.startsWith('packages/contracts/src/') && filePath.endsWith('.ts'))
  .map(readRepositoryFile);
const contractTokens = collectContractTokens(contracts, contractSourceTexts);
const scannedFiles = repositoryFiles.filter(isSingleDefinitionScanned);
const findingLines = scannedFiles.flatMap((filePath) =>
  findRedeclarations(filePath, readRepositoryFile(filePath), contractTokens).map(
    (finding) => `${finding.filePath}:${String(finding.line)} ${finding.rule}: ${finding.detail}`,
  ),
);
reportAndExit('single definition check', findingLines, scannedFiles.length);
