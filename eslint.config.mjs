import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'release/**',
      '**/*.config.js',
      '**/*.config.ts',
      '**/*.config.mjs',
      'packages/server/build.mjs',
      'scripts/**',
    ],
  },
  // Untyped recommended rules — fast enough to run everywhere; the real type
  // safety comes from `tsc` in the build task.
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          // `const { [k]: _, ...rest } = obj` omit pattern
          ignoreRestSiblings: true,
          caughtErrors: 'none',
        },
      ],
    },
  },
  {
    files: ['apps/renderer/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Deps issues are real bugs but occasionally intentional (tick effects);
      // warn so they're visible without blocking the pipeline.
      'react-hooks/exhaustive-deps': 'warn',
      // React-Compiler-era rules from the v7 recommended set — they flag this
      // app's core deliberate patterns (clock/timer widgets reading Date.now()
      // in tick-driven renders, sync-from-server setState effects). Adopting
      // them means an app-wide rewrite for a compiler we don't use; off until
      // that's ever on the table. Classic rules-of-hooks stay at error.
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/component-hook-factories': 'off',
    },
  },
);
