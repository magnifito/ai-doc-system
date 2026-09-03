/** Filesystem and git helpers shared by the docs scripts. */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { loadConfig } from './docs-config.mjs'

export function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
}

/**
 * Every `.md` under the configured docs directory, repo-relative, POSIX, sorted.
 * Symlinks are not followed — a symlinked directory can cycle back into the
 * tree and hang the walk, and a linked document's real copy is walked anyway.
 */
export function listDocs(root, config = loadConfig(root)) {
  const out = []
  const start = join(root, config.docsDir)
  if (existsSync(start)) walk(start)
  return out.sort()

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name.endsWith('.md')) {
        out.push(relative(root, full).split(/[\\/]/).join('/'))
      }
    }
  }
}

/**
 * Last commit date for EVERY path, from one `git log` walk. The advisory pass
 * used to spawn one `git log` per document; on a few hundred documents that is
 * a few hundred subprocesses. Newest commits come first, so the first time a
 * path is seen wins. Directories are covered too: a directory's date is the
 * newest date of any path beneath it.
 */
export function lastCommitDates(root) {
  const dates = new Map()
  let out
  try {
    out = execFileSync('git', ['log', '--name-only', '--format=%x00%ad', '--date=short'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    })
  } catch {
    return dates
  }
  let current = ''
  for (const line of out.split('\n')) {
    if (line.startsWith('\0')) {
      current = line.slice(1).trim()
      continue
    }
    const path = line.trim()
    if (!path) continue
    if (!dates.has(path)) dates.set(path, current)
    let dir = path
    while (dir.includes('/')) {
      dir = dir.slice(0, dir.lastIndexOf('/'))
      if (!dates.has(dir)) dates.set(dir, current)
    }
  }
  return dates
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
