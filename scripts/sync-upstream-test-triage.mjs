#!/usr/bin/env node
// Prints the repo-relative test files that failed in a vitest JSON report, one per line.
// Exit 2 when the report is missing or unreadable, so callers never read "no failures" into it.
import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const [reportPath, root = process.cwd()] = process.argv.slice(2)
let report
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'))
} catch (error) {
  console.error(`sync-upstream-test-triage: cannot read ${reportPath}: ${error.message}`)
  process.exit(2)
}
const failed = new Set()
for (const file of report.testResults ?? []) {
  if (file.status !== 'passed') {
    failed.add(relative(resolve(root), resolve(root, file.name)))
  }
}
for (const file of [...failed].sort()) {
  console.log(file)
}
