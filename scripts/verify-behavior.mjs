import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** Smoke entry points must test behavior when implementation moves between modules.
 * Check the assertion count as well as the exit code: an empty/filter-missed run
 * is not evidence for the contract being guarded.
 */
export function verifyBehavior(files) {
  const directory = mkdtempSync(join(tmpdir(), 'vapor-behavior-'))
  const output = join(directory, 'result.json')
  try {
    const run = spawnSync('pnpm', ['exec', 'vitest', 'run', ...files, '--reporter=json', `--outputFile=${output}`], {
      cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8', timeout: 120_000,
    })
    if (run.status !== 0) {
      throw new Error(`Behavior contract failed (${files.join(', ')}):\n${run.stdout ?? ''}\n${run.stderr ?? ''}\n${run.error ?? ''}`)
    }
    const result = JSON.parse(readFileSync(output, 'utf8'))
    if (result.numTotalTests === 0 || result.numPassedTests !== result.numTotalTests) {
      throw new Error(`Behavior contract did not execute every assertion: ${JSON.stringify(result)}`)
    }
    console.log(`Behavior contract: ${result.numPassedTests} tests passed (${files.join(', ')})`)
    return true
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
