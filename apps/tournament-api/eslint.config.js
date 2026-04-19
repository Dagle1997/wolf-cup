// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.js'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
      'no-restricted-imports': ['error', {
        paths: [{
          name: '@wolf-cup/engine',
          message: 'Tournament may only import from @wolf-cup/engine/stableford (FD-11/12). Use the subpath import.',
        }],
        patterns: [{
          group: ['@wolf-cup/engine/*', '!@wolf-cup/engine/stableford'],
          message: 'Tournament may only import @wolf-cup/engine/stableford (FD-11/12).',
        }],
      }],
    },
  },
);
