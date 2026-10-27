// Used by `npx playwright merge-reports` to combine chunked runs into one report.
module.exports = {
  testDir: './tests',
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'merged-results.json' }],
  ],
};
