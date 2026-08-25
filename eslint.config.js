import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'scripts/**'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'error',
        { allowConstantExport: true },
      ],
      // Incremental typing debt: legacy modules still use `any` around Supabase
      // rows. Kept as a warning so CI stays green while types are tightened
      // file-by-file. New code must not introduce `any`.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'max-lines': ['warn', { max: 900, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['warn', { max: 180, skipBlankLines: true, skipComments: true }],
      'complexity': ['warn', 20],
    },
  },
  {
    // Vendored chart registry sources (`@bklit` / bklit-ui, shadcn registry).
    // Kept byte-faithful to upstream; they export hooks and palette constants
    // alongside components, which `only-export-components` forbids by design,
    // their core components exceed our function-length style metric, and
    // upstream aliases the d3 curve factory to `any` (biome-exempt there).
    files: ['src/components/charts/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
      'max-lines-per-function': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  }
);
