import globals from 'globals';
import pluginJs from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '.agents/**', 'blueprint/**'] },
  { files: ['**/*.{js,mjs,cjs,ts,tsx}'] },
  { languageOptions: { globals: { ...globals.node, ...globals.browser, Bun: 'readonly' } } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  // The web app must ship no stray console output: the pre-auth /me 401 probe
  // and the redirect effect used to log on every render, which trips the E2E
  // console-error gate (#175) once login flows are covered (#203).
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: {
      'no-console': 'error',
    },
  },
];
