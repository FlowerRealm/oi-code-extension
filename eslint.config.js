import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
      },
      globals: {
        // VS Code API globals
        'vscode': 'readonly',
        // CommonJS globals
        'require': 'readonly',
        'module': 'readonly',
        'exports': 'readonly',
        '__dirname': 'readonly',
        '__filename': 'readonly',
        'global': 'readonly',
        'process': 'readonly',
        // Test globals
        'suite': 'readonly',
        'test': 'readonly',
        'describe': 'readonly',
        'it': 'readonly',
        'before': 'readonly',
        'after': 'readonly',
        'beforeEach': 'readonly',
        'afterEach': 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
      'no-undef': 'off',
      'no-useless-escape': 'off',
      'no-empty': 'off',
      'prefer-const': 'warn',
      // 忽略特定的误报
      'no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }],
    },
  },
];