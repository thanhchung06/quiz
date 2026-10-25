const base = require('./jest.config');

module.exports = {
  ...base,
  testPathIgnorePatterns: ['<rootDir>/node_modules/'],
  testMatch: ['<rootDir>/tests/perf/**/*.spec.ts'],
};
