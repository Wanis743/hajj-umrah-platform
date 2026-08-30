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
      // No `any`, anywhere, including future modifications: there is no
      // per-directory exemption below and `verify:any` enforces the same rule
      // from the command line so a config edit cannot quietly reopen the door.
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
    // Two *style* metrics are relaxed here because upstream's shape genuinely
    // differs from ours: these modules export hooks and palette constants
    // alongside components, which `only-export-components` forbids by design,
    // and their core components exceed our function-length metric.
    //
    // Type safety is NOT relaxed. `no-explicit-any` used to be off here because
    // upstream aliased the d3 curve factory to `any`; the six aliases now import
    // the real `CurveFactory` from `d3-shape`, so the exemption is gone.
    files: ['src/components/charts/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
      'max-lines-per-function': 'off',
    },
  }
);
