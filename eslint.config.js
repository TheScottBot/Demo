// Lint is run with --max-warnings 0, so every rule here is effectively an error
// (datum 0.10: warnings as errors).
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import eslintJavaScript from '@eslint/js';
import typescriptEslint from 'typescript-eslint';

// Modules that every specification lists as pure (datum 0.10, Spec 00 §2.4
// check 2), and the imports they may not make. The one list is
// tree-checks/pure-modules.json, which the continuous integration check reads
// too; lint gives the same answer earlier, in the editor.
const pureModuleConfiguration = JSON.parse(
  readFileSync(new URL('./tree-checks/pure-modules.json', import.meta.url), 'utf8'),
);

const pureModuleGlobs = pureModuleConfiguration.pureModuleDirectories.map(
  (pureDirectory) => `${pureDirectory}/**/*.ts`,
);

const importsForbiddenInPureModules = pureModuleConfiguration.forbiddenImports.map(
  (forbiddenImport) => ({ group: forbiddenImport.patterns, message: forbiddenImport.reason }),
);

// Datum 0.5 forbids these names outright, whatever the surrounding idiom.
const namesForbiddenByDatum = [
  'mgr',
  'svc',
  'util',
  'helper',
  'data',
  'item',
  'tmp',
  'buf',
  'msg',
  'cb',
  'handle',
  'process',
  'run',
  'execute',
  'ctx',
];

export default typescriptEslint.config(
  { ignores: ['**/node_modules/**', '**/coverage/**', '**/cdk.out/**'] },
  eslintJavaScript.configs.recommended,
  ...typescriptEslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Datum 0.5: no single letter name except a loop index.
      'id-length': ['error', { min: 2, exceptions: ['i', 'j', 'k'], properties: 'never' }],
      'id-denylist': ['error', ...namesForbiddenByDatum],
      // Acronyms are written as one word (HttpProblem, not HTTPProblem), as the
      // reference implementations do.
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'typeLike', format: ['StrictPascalCase'] },
        {
          selector: 'interface',
          format: ['StrictPascalCase'],
          custom: { regex: '^I[A-Z]', match: false },
        },
      ],
    },
  },
  {
    files: ['**/*.js'],
    ...typescriptEslint.configs.disableTypeChecked,
  },
  {
    files: pureModuleGlobs,
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: importsForbiddenInPureModules.map((restriction) => ({
            ...restriction,
            allowTypeImports: false,
          })),
        },
      ],
    },
  },
);
