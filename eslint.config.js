import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import prettierConfig from 'eslint-config-prettier';

/**
 * ESLint flat config for datto-rmm-api-client.
 *
 * Aligned in structure with @pncit/fuze-api's config (flat config, ESM,
 * typescript-eslint recommended, prettier last) so `npm run lint` behaves the
 * same across pncit libraries. The filename-case (kebab) and import-order rules
 * fuze enforces are intentionally omitted here: this repo uses camelCase source
 * filenames (rateLimiter.ts, httpClient.ts, tokenStore.ts) and adopting those
 * rules would be a rename/reorder refactor unrelated to CI/CD.
 */
export default [
  // Base JavaScript recommended rules
  js.configs.recommended,

  // Global ignores — aligned with tsconfig.json exclude paths
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '*.config.js'],
  },

  // TypeScript source files (excludes tests, which get a looser config below)
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts', 'src/__tests__/**'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      // TypeScript's compiler already reports undefined identifiers, and
      // no-undef produces false positives for platform globals (URLSearchParams,
      // console, __dirname). typescript-eslint recommends disabling it.
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',

      // General code quality
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'prefer-template': 'error',
      'no-throw-literal': 'error',
    },
  },

  // Test files — looser rules
  {
    files: ['src/**/*.test.ts', 'src/__tests__/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        // Jest globals
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        jest: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-console': 'off',
    },
  },

  // Prettier config (must be last to override formatting rules)
  prettierConfig,
];
