import globals from 'globals';
import pluginJs from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '.agents/**', 'blueprint/**'] },
  { files: ['**/*.{js,mjs,cjs,ts}'] },
  { languageOptions: { globals: { ...globals.node, Bun: 'readonly' } } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
];
