import ts from 'typescript';
import pureModuleConfiguration from '../pure-modules.json';

// Datum 0.10 and Spec 00 §2.4 check 2. The list of pure modules and of the
// imports they may not make is pure-modules.json, read by this check and by
// eslint.config.js alike, so the two cannot disagree.

export interface ForbiddenImportFinding {
  readonly filePath: string;
  readonly line: number;
  readonly specifier: string;
  readonly reason: string;
}

export function isPureModulePath(filePath: string): boolean {
  return pureModuleConfiguration.pureModuleDirectories.some((pureDirectory) =>
    filePath.startsWith(`${pureDirectory}/`),
  );
}

// The same pattern form ESLint's restricted imports use: an exact name, or a
// name followed by `/*` for everything beneath it.
function matchesImportPattern(specifier: string, importPattern: string): boolean {
  if (importPattern.endsWith('/*')) {
    return specifier.startsWith(importPattern.slice(0, -1));
  }
  return specifier === importPattern;
}

export function findForbiddenImports(
  filePath: string,
  sourceText: string,
): ForbiddenImportFinding[] {
  if (!isPureModulePath(filePath)) {
    return [];
  }
  // TypeScript's own pre-processor finds static imports, re-exports, dynamic
  // imports and require calls, and is not fooled by an import inside a string.
  const { importedFiles } = ts.preProcessFile(sourceText, true, true);
  const findings: ForbiddenImportFinding[] = [];
  for (const importedFile of importedFiles) {
    const forbiddenImport = pureModuleConfiguration.forbiddenImports.find((candidate) =>
      candidate.patterns.some((importPattern) =>
        matchesImportPattern(importedFile.fileName, importPattern),
      ),
    );
    if (forbiddenImport !== undefined) {
      findings.push({
        filePath,
        line: sourceText.slice(0, importedFile.pos).split('\n').length,
        specifier: importedFile.fileName,
        reason: forbiddenImport.reason,
      });
    }
  }
  return findings;
}
