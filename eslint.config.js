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
        project: './tsconfig.json',
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
      // Code Formatting and Indentation
      'indent': ['error', 4, {
        'SwitchCase': 1,
        'VariableDeclarator': 1,
        'outerIIFEBody': 1,
        'MemberExpression': 1,
        'FunctionDeclaration': { 'parameters': 1, 'body': 1 },
        'FunctionExpression': { 'parameters': 1, 'body': 1 },
        'CallExpression': { 'arguments': 1 },
        'ArrayExpression': 1,
        'ObjectExpression': 1,
        'ImportDeclaration': 1,
        'flatTernaryExpressions': false,
        'ignoreComments': false
      }],
      'linebreak-style': ['error', 'unix'],
      'quotes': ['error', 'single', { 'avoidEscape': true }],
      'semi': ['error', 'always'],
      'comma-dangle': ['error', 'never'],
      'comma-spacing': ['error', { 'before': false, 'after': true }],
      'comma-style': ['error', 'last'],
      'brace-style': ['error', '1tbs', { 'allowSingleLine': true }],
      'camelcase': ['error', { 'properties': 'always' }],
      'key-spacing': ['error', { 'beforeColon': false, 'afterColon': true }],
      'keyword-spacing': ['error', { 'before': true, 'after': true }],
      'space-before-blocks': ['error', 'always'],
      'space-before-function-paren': ['error', {
        'anonymous': 'always',
        'named': 'never',
        'asyncArrow': 'always'
      }],
      'space-in-parens': ['error', 'never'],
      'space-infix-ops': 'error',
      'space-unary-ops': ['error', { 'words': true, 'nonwords': false }],
      'spaced-comment': ['error', 'always', {
        'line': { 'markers': ['/'], 'exceptions': ['-', '+'], 'markers': ['*'] },
        'block': { 'markers': ['*'], 'balanced': true }
      }],
      'no-trailing-spaces': 'error',
      'eol-last': 'error',
      'max-len': ['error', { 'code': 120, 'tabWidth': 4 }],
      'no-multiple-empty-lines': ['error', { 'max': 1, 'maxEOF': 1 }],
      'padded-blocks': ['error', 'never'],
      
      // TypeScript specific rules
      '@typescript-eslint/semi': ['error', 'always'],
      '@typescript-eslint/type-annotation-spacing': ['error', {
        'before': false,
        'after': true,
        'overrides': {
          'arrow': { 'before': true, 'after': true }
        }
      }],
      
      // Code quality rules
      'no-var': 'error',
      'prefer-const': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }],
      'no-console': ['error', { 'allow': ['log', 'warn', 'error'] }],
      'prefer-arrow-callback': 'error',
      'arrow-spacing': 'error',
      'object-curly-spacing': ['error', 'always'],
      'array-bracket-spacing': ['error', 'never'],
      'computed-property-spacing': ['error', 'never'],
      'template-curly-spacing': ['error', 'never'],
      
      // Best practices
      'eqeqeq': ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'prefer-template': 'error',
      
      // Error prevention
      'no-undef': 'off',
      'no-unexpected-multiline': 'error',
      'no-unsafe-finally': 'error',
      'no-unsafe-negation': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      
      // Existing rules with adjustments
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-useless-escape': 'warn',
      'no-empty': ['error', { 'allowEmptyCatch': true }],
      'prefer-const': 'error',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
];