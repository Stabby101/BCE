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
