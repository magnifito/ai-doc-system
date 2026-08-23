/** Filesystem and git helpers shared by the docs scripts. */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { loadConfig } from './docs-config.mjs'

export function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
}

/** Every `.md` under the configured docs directory, repo-relative, POSIX, sorted. */
export function listDocs(root, config = loadConfig(root)) {
  const out = []
  const start = join(root, config.docsDir)
  if (existsSync(start)) walk(start)
  return out.sort()

  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name.endsWith('.md')) out.push(relative(root, full).split(/[\\/]/).join('/'))
    }
  }
}

/** Last commit date for a path, ISO. Empty string for an uncommitted file. */
export function lastCommitDate(root, path) {
  try {
    return execFileSync('git', ['log', '-1', '--format=%ad', '--date=short', '--', path], {
      cwd: root,
      encoding: 'utf8',
    }).trim()
  } catch {
    return ''
  }
}
