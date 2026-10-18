// Datum 0.8, Spec 00 §2.4 check 1. Every planted violation is built from
// parts (code points, repeated hyphens, reversed words), so this file passes
// the very scan it tests.
import { describe, expect, it } from 'vitest';
import { scanProse } from '../src/prose-scan';

const emDash = String.fromCodePoint(0x2014);
const enDash = String.fromCodePoint(0x2013);
const doubleHyphen = '-'.repeat(2);
const tripleHyphen = '-'.repeat(3);

// A US spelling, written reversed in this file.
function usWord(reversedWord: string): string {
  // Plain ASCII, so reversing by UTF-16 unit is exact.
  return reversedWord.split('').reverse().join('');
}

function rulesFound(filePath: string, text: string): string[] {
  return scanProse(filePath, text).map((finding) => finding.rule);
}

describe('dashes', () => {
  it.each(['notes.md', 'source.ts', 'config.yml', 'package.json', 'LICENSE'])(
    'finds an em dash and an en dash in %s',
    (filePath) => {
      expect(rulesFound(filePath, `one ${emDash} two`)).toEqual(['em-dash']);
      expect(rulesFound(filePath, `pages 1${enDash}2`)).toEqual(['en-dash']);
    },
  );

  it('reports the line and column of each finding', () => {
    expect(scanProse('notes.md', `first line\nsecond ${emDash} here`)).toEqual([
      { filePath: 'notes.md', line: 2, column: 8, rule: 'em-dash' },
    ]);
  });
});

describe('hyphen runs', () => {
  it.each([
    ['a double hyphen in prose', `wait ${doubleHyphen} then go`],
    ['a triple hyphen in prose', `wait ${tripleHyphen} then go`],
    ['a double hyphen joining words', `well${doubleHyphen}known`],
    ['a bare end of options marker', `npm test ${doubleHyphen} packages`],
  ])('finds %s', (_caseName, text) => {
    expect(rulesFound('notes.md', text)).toEqual(['hyphen-run']);
  });

  it.each([
    ['a table separator row', `|${tripleHyphen}|${tripleHyphen}|`],
    ['an aligned table separator row', `| :${tripleHyphen} | ${tripleHyphen}: |`],
    ['a command line flag token', `npm run lint ${doubleHyphen}max-warnings 0`],
    ['a flag token in code', `const flag = '${doubleHyphen}enable-source-maps';`],
    ['a single hyphen', 'well-known'],
  ])('exempts %s', (_caseName, text) => {
    expect(rulesFound('notes.md', text)).toEqual([]);
  });

  it('applies to source files as well as prose', () => {
    expect(rulesFound('source.ts', `// wait ${doubleHyphen} then go`)).toEqual(['hyphen-run']);
  });
});

describe('UK and Irish spelling', () => {
  it.each(['roloc', 'roivaheb', 'ezilaitini', 'noitazinagro', 'ezylana', 'delecnac', 'tcafitra'])(
    'finds the US spelling written reversed as %s',
    (reversedWord) => {
      expect(rulesFound('notes.md', `The ${usWord(reversedWord)} is wrong.`)).toEqual([
        'us-spelling',
      ]);
    },
  );

  it('finds a US spelling regardless of case', () => {
    expect(rulesFound('notes.md', `Colour, not ${usWord('roloC')}.`)).toEqual(['us-spelling']);
  });

  it('leaves UK spellings and words that merely contain a US spelling alone', () => {
    expect(
      rulesFound(
        'notes.md',
        `colour behaviour initialise organisation analyse cancelled artefact dis${usWord('roloc')}ations`,
      ),
    ).toEqual([]);
  });

  it('checks comments and strings in source, not code', () => {
    expect(rulesFound('source.ts', `// the ${usWord('roloc')} of the thing`)).toEqual([
      'us-spelling',
    ]);
    expect(rulesFound('source.ts', `it('keeps its ${usWord('roloc')}', () => {});`)).toEqual([
      'us-spelling',
    ]);
    expect(rulesFound('source.ts', `const value = input.${usWord('ezilamron')}();`)).toEqual([]);
  });

  // AWS names the API Gateway authoriser; the platform cannot rename it.
  it('allows names the platform imposes', () => {
    expect(
      rulesFound(
        'source.ts',
        `const name = 'HttpJwt${usWord('rezirohtuA')}'; // the ${usWord('rezirohtua')} field`,
      ),
    ).toEqual([]);
    expect(rulesFound('notes.md', `requestContext.${usWord('rezirohtua')}.jwt.claims`)).toEqual([]);
  });

  it('skips spelling, but not dashes, in the generated lockfile', () => {
    expect(
      rulesFound('package-lock.json', `"node_modules/${usWord('roloc')}-convert": {}`),
    ).toEqual([]);
    expect(rulesFound('package-lock.json', `"description": "a ${emDash} b"`)).toEqual(['em-dash']);
  });
});

describe('files that are not text', () => {
  it('are skipped', () => {
    expect(rulesFound('image.png', `binary${String.fromCodePoint(0)}${emDash}`)).toEqual([]);
  });
});

// Added at the author's instruction, 18 October 2026: the family is an
// anonymous proof of concept, so no file may name the real domain. Every
// term is written reversed here, as in the scan's own list.
describe('identifying terms', () => {
  it.each([
    ['an organisation acronym', 'shn'],
    ['the record type, two words', 'nalp erac'],
    ['the record type, plural', 'snalp erac'],
    ['a subject of the records', 'tneitap'],
    ['a domain adjective', 'lacinilc'],
    ['a professional', 'esrun'],
    ['a place', 'latipsoh'],
    ['a domain noun', 'noitpircserp'],
    // Found missing by the local demo phase: the list held a misspelling.
    ['the sector, one word', 'erachtlaeh'],
  ])('finds %s in prose', (_caseName, reversedTerm) => {
    expect(rulesFound('notes.md', `A line about the ${usWord(reversedTerm)} here.`)).toEqual([
      'identifying-term',
    ]);
  });

  it('finds a term in any case, and joined as a code identifier', () => {
    expect(rulesFound('notes.md', usWord('SHN'))).toEqual(['identifying-term']);
    expect(rulesFound('source.ts', `const ${usWord('dIsnalPerac')} = 1;`)).toEqual([
      'identifying-term',
    ]);
    expect(rulesFound('source.ts', `const ${usWord('nalp_erac')} = 1;`)).toEqual([
      'identifying-term',
    ]);
  });

  it('checks code, not only comments and strings, since an identifier names the domain too', () => {
    expect(rulesFound('source.ts', `const ${usWord('tneitap')}Record = 1;`)).toEqual([
      'identifying-term',
    ]);
  });

  it('leaves words that merely contain a term alone', () => {
    expect(rulesFound('notes.md', 'diagnostics, impatience and the word technique')).toEqual([]);
  });

  it('skips the generated lockfile, whose hashes can hold any letters', () => {
    expect(
      rulesFound('package-lock.json', `"integrity": "sha512-abc/${usWord('shn')}+def"`),
    ).toEqual([]);
  });
});
