// Spec 00 §2.4 check 2: no pure module imports a platform, driver or
// operating system dependency.
import { findForbiddenImports, isPureModulePath } from '../src/pure-imports';
import { listRepositoryFiles, readRepositoryFile, reportAndExit } from './repository-files';

const pureModuleFiles = listRepositoryFiles().filter(
  (filePath) => isPureModulePath(filePath) && /\.(ts|tsx|js|mjs|cjs)$/.test(filePath),
);
const findingLines = pureModuleFiles.flatMap((filePath) =>
  findForbiddenImports(filePath, readRepositoryFile(filePath)).map(
    (finding) =>
      `${finding.filePath}:${String(finding.line)} imports ${finding.specifier}: ${finding.reason}`,
  ),
);
reportAndExit('pure import check', findingLines, pureModuleFiles.length);
