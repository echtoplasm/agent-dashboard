/**
 * Root ESLint flat config for every workspace.
 *
 * Uses type-aware typescript-eslint rules so mistakes like floating promises
 * and unsafe `any` flows are caught, and encodes the naming conventions from
 * the project brief so reviewers don't have to police them by hand.
 */
import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/** Naming rules from the project brief, enforced by `@typescript-eslint/naming-convention`. */
const NAMING_CONVENTION_RULES = [
  'error',
  { selector: 'default', format: ['camelCase'], leadingUnderscore: 'allow' },
  { selector: 'import', format: null },
  // Module-level constants may use SCREAMING_SNAKE_CASE; React components and
  // Zod schemas are PascalCase values.
  { selector: 'variable', format: ['camelCase', 'UPPER_CASE', 'PascalCase'] },
  { selector: 'function', format: ['camelCase', 'PascalCase'] },
  { selector: 'typeLike', format: ['PascalCase'] },
  {
    selector: 'interface',
    format: ['PascalCase'],
    custom: { regex: '^I[A-Z]', match: false },
  },
  {
    selector: ['variable', 'parameter'],
    types: ['boolean'],
    format: ['PascalCase', 'UPPER_CASE'],
    prefix: ['is', 'has', 'should', 'can', 'IS_', 'HAS_', 'SHOULD_', 'CAN_'],
  },
  // Object literal keys often mirror external formats (HTTP headers, SQL
  // column names in migrations, env vars), so they are not constrained.
  { selector: ['objectLiteralProperty', 'typeProperty'], format: null },
];

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.js'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/naming-convention': NAMING_CONVENTION_RULES,
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      eqeqeq: 'error',
      'no-console': 'error',
    },
  },
  {
    files: ['eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  eslintConfigPrettier,
);
