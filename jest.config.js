// Default (sanity) run: everything except the slow suites under tests/firebase and tests/perf.
// Those have their own configs: jest.firebase.config.js and jest.perf.config.js (see README "Testing").
module.exports = {
  preset: 'jest-preset-angular',
  setupFilesAfterEnv: ['<rootDir>/setup-jest.ts'],
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/tests/e2e/', '<rootDir>/tests/firebase/', '<rootDir>/tests/perf/'],
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$|dexie)'],
};
