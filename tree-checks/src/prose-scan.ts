import ts from 'typescript';

// Datum 0.8 and Spec 00 §2.4 check 1: the prose and typography scan, over
// every file the repository tracks. Nothing is vendored, so no path is
// excluded from it.
//
// Quotation marks used for emphasis are a datum 0.8 rule no tool can tell
// from quotation, so they are left to review (TESTING.md).

export type ProseRule = 'em-dash' | 'en-dash' | 'hyphen-run' | 'us-spelling' | 'identifying-term';

export interface ProseFinding {
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  readonly rule: ProseRule;
}

// US forms whose UK and Irish form differs. Whole words only, any case.
// Stored reversed, so this list is not itself a finding of the scan it
// drives; reversed back when the pattern is built.
const reversedUsSpellings = [
  'roloc',
  'sroloc',
  'deroloc',
  'gniroloc',
  'roivaheb',
  'sroivaheb',
  'laroivaheb',
  'rovaf',
  'srovaf',
  'etirovaf',
  'ronoh',
  'robal',
  'robhgien',
  'noitazinagro',
  'snoitazinagro',
  'ezinagro',
  'dezinagro',
  'sezinagro',
  'gnizinagro',
  'ezilaitini',
  'dezilaitini',
  'sezilaitini',
  'gnizilaitini',
  'noitazilaitini',
  'ezilamron',
  'dezilamron',
  'noitazilamron',
  'ezingocer',
  'dezingocer',
  'ezilaires',
  'dezilaires',
  'noitazilaires',
  'rezilaires',
  'ezylana',
  'dezylana',
  'sezylana',
  'gnizylana',
  'rezylana',
  'golatac',
  'sgolatac',
  'retnec',
  'sretnec',
  'deretnec',
  'esnefed',
  'esneffo',
  'yarg',
  'gniledom',
  'deledom',
  'delecnac',
  'gnilecnac',
  'delevart',
  'llifluf',
  'tcafitra',
  'stcafitra',
  'tnemgduj',
  'tnemgdelwonkca',
  'ezimitpo',
  'dezimitpo',
  'noitazimitpo',
  'ezitiroirp',
  'ezirammus',
  'dezirammus',
  'eziminim',
  'deziminim',
  'ezimixam',
  'ezimotsuc',
  'dezimotsuc',
  'ezirohtua',
  'dezirohtua',
  'ezilitu',
  'ezilanif',
  'dezilanif',
  'ezitinas',
  'dezitinas',
  'rezitinas',
  'ezinorhcnys',
  'ezidradnats',
  'dezidradnats',
  'ezilaiceps',
  'ezisahpme',
  'ezirogetac',
];

// The words are plain ASCII, so reversing by UTF-16 unit is exact.
const usSpellings = reversedUsSpellings.map((reversedWord) =>
  reversedWord.split('').reverse().join(''),
);

// Names a platform imposes and the family cannot change: API Gateway's
// authoriser and the HTTP Authorization header.
const platformImposedWords = new Set(['authorizer', 'authorizers', 'authorization']);

const usSpellingPattern = new RegExp(`\\b(${usSpellings.join('|')})\\b`, 'gi');

// Generated files whose text is not prose. They are still scanned for dashes.
const spellingExemptGeneratedFiles = ['package-lock.json'];

const sourceExtensions = ['.ts', '.tsx', '.js', '.mjs', '.cjs'];

const tableSeparatorRow = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function lineAndColumn(text: string, offset: number): { line: number; column: number } {
  const precedingText = text.slice(0, offset);
  const lineStart = precedingText.lastIndexOf('\n') + 1;
  return { line: precedingText.split('\n').length, column: offset - lineStart + 1 };
}

// The datum exempts exactly two forms: a Markdown table separator row and a
// command line flag token (two hyphens starting a word, such as a flag name).
function isExemptHyphenRun(lineText: string, runStart: number, runLength: number): boolean {
  if (tableSeparatorRow.test(lineText)) {
    return true;
  }
  const precedingCharacter = runStart === 0 ? undefined : lineText.charAt(runStart - 1);
  const followingCharacter = lineText.charAt(runStart + runLength);
  return (
    runLength === 2 &&
    /[A-Za-z]/.test(followingCharacter) &&
    (precedingCharacter === undefined || /[\s'"`([=]/.test(precedingCharacter))
  );
}

function findDashesAndHyphenRuns(filePath: string, text: string): ProseFinding[] {
  const findings: ProseFinding[] = [];
  const lines = text.split('\n');
  lines.forEach((lineText, lineIndex) => {
    for (const dashMatch of lineText.matchAll(/[\u2013\u2014]/g)) {
      findings.push({
        filePath,
        line: lineIndex + 1,
        column: dashMatch.index + 1,
        rule: dashMatch[0] === '\u2014' ? 'em-dash' : 'en-dash',
      });
    }
    for (const runMatch of lineText.matchAll(/-{2,}/g)) {
      if (!isExemptHyphenRun(lineText, runMatch.index, runMatch[0].length)) {
        findings.push({
          filePath,
          line: lineIndex + 1,
          column: runMatch.index + 1,
          rule: 'hyphen-run',
        });
      }
    }
  });
  return findings;
}

// In source, only comments and string literals are prose; code tokens are
// names, many of them imposed by the language or a library.
function proseRangesInSource(filePath: string, text: string): [number, number][] {
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
  const ranges = new Map<number, number>();
  const addCommentRanges = (commentRanges: ts.CommentRange[] | undefined) => {
    for (const commentRange of commentRanges ?? []) {
      ranges.set(commentRange.pos, commentRange.end);
    }
  };
  const visit = (node: ts.Node) => {
    addCommentRanges(ts.getLeadingCommentRanges(text, node.getFullStart()));
    addCommentRanges(ts.getTrailingCommentRanges(text, node.getEnd()));
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      ranges.set(node.getStart(sourceFile), node.getEnd());
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  addCommentRanges(ts.getLeadingCommentRanges(text, sourceFile.getEnd()));
  return [...ranges.entries()];
}

function findUsSpellings(
  filePath: string,
  text: string,
  ranges: [number, number][],
): ProseFinding[] {
  const findings: ProseFinding[] = [];
  for (const [rangeStart, rangeEnd] of ranges) {
    for (const spellingMatch of text.slice(rangeStart, rangeEnd).matchAll(usSpellingPattern)) {
      if (!platformImposedWords.has(spellingMatch[0].toLowerCase())) {
        findings.push({
          filePath,
          ...lineAndColumn(text, rangeStart + spellingMatch.index),
          rule: 'us-spelling',
        });
      }
    }
  }
  return findings;
}

// The family is an anonymous proof of concept (the author, 18 October 2026):
// no file may name the real organisation or its domain. Stored reversed, like
// the spelling list, so the list is not itself a finding; a space in a term
// matches an optional space, and every term may take a plural s.
const reversedIdentifyingTerms = [
  'shn',
  'nalp erac',
  'tneitap',
  'lacinilc',
  'naicinilc',
  'latipsoh',
  'esrun',
  'gnisrun',
  'noitpircserp',
  'noitacidem',
  'erachtlaeh',
  'sisongaid',
  'sesongaid',
];

const identifyingTermPattern = new RegExp(
  `\\b(${reversedIdentifyingTerms
    .map((reversedTerm) => reversedTerm.split('').reverse().join('').replaceAll(' ', ' ?'))
    .join('|')})s?\\b`,
  'i',
);

// Identifiers name the domain as surely as prose does, so code is read too,
// split into words first: recordSectionId and record_section both become
// record section before matching.
function wordsOf(lineText: string): string {
  return lineText.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
}

function findIdentifyingTerms(filePath: string, text: string): ProseFinding[] {
  const findings: ProseFinding[] = [];
  text.split('\n').forEach((lineText, lineIndex) => {
    if (identifyingTermPattern.test(wordsOf(lineText))) {
      findings.push({ filePath, line: lineIndex + 1, column: 1, rule: 'identifying-term' });
    }
  });
  return findings;
}

export function scanProse(filePath: string, text: string): ProseFinding[] {
  // A NUL byte marks a binary file, which holds no prose.
  if (text.includes('\u0000')) {
    return [];
  }
  const findings = findDashesAndHyphenRuns(filePath, text);
  const isGeneratedFile = spellingExemptGeneratedFiles.some((generatedFile) =>
    filePath.endsWith(generatedFile),
  );
  if (!isGeneratedFile) {
    const isSource = sourceExtensions.some((extension) => filePath.endsWith(extension));
    const proseRanges: [number, number][] = isSource
      ? proseRangesInSource(filePath, text)
      : [[0, text.length]];
    findings.push(...findUsSpellings(filePath, text, proseRanges));
    findings.push(...findIdentifyingTerms(filePath, text));
  }
  return findings.sort((first, second) => first.line - second.line || first.column - second.column);
}
