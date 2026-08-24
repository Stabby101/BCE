/*
 * BCE api — Jest config (DIRECTIVE-HARDEN-6). NestJS-idiomatic unit tests over the api source. Transform via
 * @swc/jest (reuses the already-pinned @swc/core the webpack build uses — no ts-node, no ts-jest). The swc
 * target is pinned to es2022 here: the pinned @swc/core ~1.5.7 predates the api tsconfig's es2023, so an
 * explicit supported target avoids the inferred-config mismatch. Scope: *.spec.ts under src/.
 */
module.exports = {
  displayName: 'api',
  rootDir: 'src',
  testEnvironment: 'node',
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\.ts$': ['@swc/jest', {
      jsc: { target: 'es2022', parser: { syntax: 'typescript', decorators: true } },
    }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  clearMocks: true,
};
