import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'release/**', 'coverage/**', 'node_modules/**', '**/*.d.ts'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    rules: {
      'no-undef': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }]
    }
  },
  { files: ['tests/**/*.ts'], rules: { '@typescript-eslint/no-unused-expressions': 'off' } },
  {
    files: ['src/injected/runtime-modules/**/*.ts', 'tests/**/*.ts'],
    rules: {
      // 原生代理既接收可调用也接收可构造对象；签名包装器保留length及完整arguments。
      '@typescript-eslint/no-unsafe-function-type': 'off',
      'prefer-rest-params': 'off'
    }
  }
);
