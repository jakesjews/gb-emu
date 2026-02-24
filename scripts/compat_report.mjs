#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const STRICT_COMPAT = process.env.GB_COMPAT_STRICT !== '0';
const REPORT_DIR = path.resolve(process.cwd(), 'test-results/compat');
const OUTPUT_PATH = path.join(REPORT_DIR, 'summary.md');
const REQUIRED_REPORTS = [
  'blargg.json',
  'mooneye-tier1.json',
  'mooneye-tier2.json',
  'mooneye-tier3a.json',
];
const OPTIONAL_REPORTS = ['mooneye-tier3b.json'];

function readJson(fileName) {
  const filePath = path.join(REPORT_DIR, fileName);
  if (!existsSync(filePath)) {
    throw new Error(`Missing compatibility report file: ${filePath}`);
  }

  const raw = readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function buildSummary(reports, strictFailures) {
  const generatedAt = new Date().toISOString();
  const lines = [
    '# Compatibility Summary',
    '',
    `- Generated at: ${generatedAt}`,
    `- Strict mode: ${STRICT_COMPAT ? 'enabled' : 'disabled'}`,
    '- Tier-3B (`mooneye-tier3b`) is informational shadow coverage until promotion.',
    '',
    '| Suite | Tier | Strict | Total | Pass | Fail | Timeout | Skipped |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
  ];

  for (const report of reports) {
    const tierLabel = report.tier === 'tier3b' ? 'tier3b (shadow)' : report.tier;
    lines.push(
      `| ${report.suite} | ${tierLabel} | ${report.strict ? 'yes' : 'no'} | ${report.totals.total} | ${report.totals.passed} | ${report.totals.failed} | ${report.totals.timedOut} | ${report.totals.skipped} |`,
    );
  }

  lines.push('');

  if (strictFailures.length === 0) {
    lines.push('## Strict Gate');
    lines.push('');
    lines.push('All required compatibility cases are passing with zero skips.');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('## Strict Gate Failures');
  lines.push('');
  lines.push('| Suite | Tier | Case | Status | Skipped | Reason |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const failure of strictFailures) {
    const reason = failure.reason ?? '';
    lines.push(
      `| ${failure.suite} | ${failure.tier} | ${failure.name} | ${failure.status} | ${failure.skipped ? 'yes' : 'no'} | ${reason} |`,
    );
  }
  lines.push('');

  return lines.join('\n');
}

function collectStrictFailures(reports) {
  const failures = [];

  for (const report of reports) {
    if (report.totals.total === 0) {
      failures.push({
        suite: report.suite,
        tier: report.tier,
        name: '(suite total)',
        status: 'missing',
        skipped: false,
        reason: 'No compatibility cases were recorded for this suite.',
      });
    }

    for (const testCase of report.cases) {
      if (testCase.skipped || testCase.status !== 'pass') {
        failures.push({
          suite: report.suite,
          tier: report.tier,
          ...testCase,
        });
      }
    }
  }

  return failures;
}

function main() {
  mkdirSync(REPORT_DIR, { recursive: true });
  const requiredReports = REQUIRED_REPORTS.map(readJson);
  const optionalReports = OPTIONAL_REPORTS.filter((fileName) =>
    existsSync(path.join(REPORT_DIR, fileName)),
  ).map(readJson);
  const reports = [...requiredReports, ...optionalReports];
  const strictFailures = collectStrictFailures(requiredReports);
  const summary = buildSummary(reports, strictFailures);
  writeFileSync(OUTPUT_PATH, `${summary}\n`, 'utf8');

  console.log(`Wrote compatibility summary: ${OUTPUT_PATH}`);

  if (!STRICT_COMPAT) {
    return;
  }

  if (strictFailures.length > 0) {
    const details = strictFailures
      .map(
        (failure) =>
          `${failure.suite}/${failure.tier} ${failure.name} status=${failure.status} skipped=${failure.skipped ? 'yes' : 'no'} reason=${failure.reason ?? ''}`,
      )
      .join('\n');
    throw new Error(`Strict compatibility report gate failed:\n${details}`);
  }
}

main();
