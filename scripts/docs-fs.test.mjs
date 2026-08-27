/**
 * Tests for the shared filesystem helpers.
 *
 * Run: node --test scripts/docs-fs.test.mjs
 */
import { strict as assert } from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { listDocs } from './docs-fs.mjs'
import { DEFAULTS, withDerived } from './docs-config.mjs'

test('a symlinked directory is not followed, so a cycle cannot hang the walk', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'docs-fs-'))
  try {
    mkdirSync(join(root, 'docs/engineering'), { recursive: true })
    writeFileSync(join(root, 'docs/engineering/a.md'), '# A\n')
    try {
      symlinkSync(join(root, 'docs'), join(root, 'docs/engineering/loop'))
    } catch (error) {
      // Windows denies symlink creation without developer mode; the behaviour
      // under test is POSIX-reachable, so skipping there is honest.
      if (error.code === 'EPERM') return t.skip('symlinks not permitted on this runner')
      throw error
    }
    assert.deepEqual(listDocs(root, withDerived(DEFAULTS)), ['docs/engineering/a.md'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
