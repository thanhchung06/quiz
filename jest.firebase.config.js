const base = require('./jest.config');

module.exports = {
  ...base,
  testPathIgnorePatterns: ['<rootDir>/node_modules/'],
  testMatch: ['<rootDir>/tests/firebase/**/*.spec.ts'],
};
