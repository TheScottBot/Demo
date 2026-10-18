// Lint is run with --max-warnings 0, so every rule here is effectively an error
// (datum 0.10: warnings as errors).
import eslintJavaScript from '@eslint/js';
import typescriptEslint from 'typescript-eslint';

// Modules that every specification lists as pure (datum 0.10, Spec 00 §2.4
// check 2). They must build and test with nothing but the Node.js toolchain.
const pureModuleGlobs = ['packages/contracts/src/**/*.ts'];

// Spec 00 §2.4 check 2 names exactly these imports as forbidden in a pure module.
const importsForbiddenInPureModules = [
  { group: ['@aws-sdk/*'], message: 'Pure module: no AWS SDK (Spec 00 §2.4 check 2).' },
  {
    group: ['aws-cdk-lib', 'aws-cdk-lib/*'],
    message: 'Pure module: no CDK (Spec 00 §2.4 check 2).',
  },
  {
    group: ['@aws-lambda-powertools/*'],
    message: 'Pure module: no Powertools; take the CQ3 interfaces instead (Spec 00 §2.4 check 2).',
  },
  {
    group: ['node:fs', 'node:fs/*', 'fs', 'fs/*'],
    message: 'Pure module: no filesystem (Spec 00 §2.4 check 2).',
  },
  { group: ['node:net', 'net'], message: 'Pure module: no sockets (Spec 00 §2.4 check 2).' },
  {
    group: ['node:http', 'http'],
    message: 'Pure module: no HTTP server or client (Spec 00 §2.4 check 2).',
  },
  {
    group: ['node:child_process', 'child_process'],
    message: 'Pure module: no child processes (Spec 00 §2.4 check 2).',
  },
];

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
