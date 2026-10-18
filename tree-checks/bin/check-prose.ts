// Spec 00 §2.4 check 1: the prose and typography scan over every file the
// repository holds.
import { scanProse } from '../src/prose-scan';
import { listRepositoryFiles, readRepositoryFile, reportAndExit } from './repository-files';

const repositoryFiles = listRepositoryFiles();
const findingLines = repositoryFiles.flatMap((filePath) =>
  scanProse(filePath, readRepositoryFile(filePath)).map(
    (finding) =>
      `${finding.filePath}:${String(finding.line)}:${String(finding.column)} ${finding.rule}`,
  ),
);
reportAndExit('prose scan', findingLines, repositoryFiles.length);
