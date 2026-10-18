import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import nodeProcess from 'node:process';

// The shell side of the tree checks (datum Part 3): it lists and reads files
// and prints what the pure modules in ../src return.

export const repositoryRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim();

// Tracked files, and untracked ones git would add, so a check run before the
// author commits sees exactly what the commit will hold. Ignored files are
// never listed.
export function listRepositoryFiles(): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\u0000')
    .filter((filePath) => filePath.length > 0);
}

export function readRepositoryFile(filePath: string): string {
  return readFileSync(join(repositoryRoot, filePath), 'utf8');
}

export function reportAndExit(
  checkName: string,
  findingLines: readonly string[],
  filesChecked: number,
): void {
  for (const findingLine of findingLines) {
    console.error(findingLine);
  }
  if (findingLines.length > 0) {
    console.error(
      `${checkName}: ${String(findingLines.length)} finding(s) in ${String(filesChecked)} file(s).`,
    );
    nodeProcess.exitCode = 1;
    return;
  }
  console.log(`${checkName}: no findings in ${String(filesChecked)} file(s).`);
}
