/** Filesystem and git helpers shared by the docs scripts. */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { loadConfig } from './docs-config.mjs'

export function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
}

/**
 * `existsSync` with the case checked, because macOS and Windows resolve
 * `./FOO.md` to `foo.md` and would report a link as live after the file was
 * renamed. The same tree then fails on Linux. EVERY segment is checked against
 * its parent's real listing — a wrong-case directory in the middle of a link
 * is the same defect as a wrong-case basename.
 */
export function existsCaseExact(root, repoRelative, listings = new Map()) {
  if (!existsSync(join(root, repoRelative))) return false
  let dir = root
  for (const segment of repoRelative.split('/')) {
    // One readdir per directory per run, not per link — `listings` is shared
    // across every target checkDocs resolves.
    let names = listings.get(dir)
    if (!names) {
      try {
        names = new Set(readdirSync(dir))
      } catch {
        names = new Set()
      }
      listings.set(dir, names)
    }
    if (!names.has(segment)) return false
    dir = join(dir, segment)
  }
  return true
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
 * newest date of any path beneath it. A path renamed away is dated by its last
 * content commit, not by the rename that retired it.
 *
 * `core.quotePath=false` is not optional: the default C-quotes any non-ASCII
 * path, so `dir/café.md` would arrive as `"dir/caf\303\251.md"` and never
 * match a lookup.
 */
export function lastCommitDates(root) {
  const dates = new Map()
  let out
  try {
    out = execFileSync(
      'git',
      ['-c', 'core.quotePath=false', 'log', '--name-only', '--format=%x00%ad', '--date=short'],
      { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] },
    )
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
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return ''
  }
}

/**
 * Repo-relative paths that changed.
 *
 * With `base`, the diff from the merge base of `base` and `HEAD` to the working
 * tree, TRACKED FILES ONLY — the merge base so commits landed on `base` since
 * the fork are not reported as this branch's work, the working tree so a local
 * run sees edits that are not committed yet. A `base` that does not resolve
 * throws: on a shallow CI checkout `origin/main` often is not fetched, and
 * silently reporting "nothing changed" is the one answer a reader must not get.
 *
 * Without `base`, the working tree plus the index, untracked files included; a
 * repository with no commits at all falls back to the index and the untracked
 * files alone, because there is no `HEAD` to diff against.
 *
 * `core.quotePath=false` for the same reason as `lastCommitDates`: the default
 * C-quotes a non-ASCII path, which would then match no claim.
 */
export function changedPaths(root, base) {
  const git = (args) =>
    execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .split('\n')
      .filter(Boolean)
  const untracked = () => git(['ls-files', '--others', '--exclude-standard'])
  if (base) {
    if (!refExists(root, base)) throw new Error(`base ref "${base}" does not resolve — fetch it or omit --base`)
    return git(['diff', '--name-only', mergeBase(root, base)])
  }
  try {
    return [...new Set([...git(['diff', '--name-only', 'HEAD']), ...untracked()])]
  } catch {
    return [...new Set([...git(['diff', '--name-only', '--cached']), ...untracked()])]
  }
}

/** Whether `ref` resolves in this repository. */
export function refExists(root, ref) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return true
  } catch {
    return false
  }
}

/**
 * The commit `base` and `HEAD` forked from, which is the only honest "before"
 * for a branch: comparing against the TIP of `base` would attribute every
 * commit landed there since the fork to this branch, and would keep reporting
 * a violation for ever once the branch is merged. Falls back to the ref itself
 * when there is no merge base — unrelated histories, or a repository with no
 * `HEAD` yet.
 */
export function mergeBase(root, base) {
  const rev = (args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  try {
    return rev(['merge-base', base, 'HEAD'])
  } catch {
    try {
      return rev(['rev-parse', base])
    } catch {
      return base
    }
  }
}

/**
 * Renames git detected between `ref` and the working tree, as
 * `new path -> old path`. A document that moved without `promoted_from` is
 * still a document with a history, and this is the only way to find it.
 *
 * `core.quotePath=false` for the same reason as `lastCommitDates`: the default
 * C-quotes a non-ASCII path, which would then match no document.
 */
export function renamedFrom(root, ref) {
  const renames = new Map()
  let out
  try {
    out = execFileSync('git', ['-c', 'core.quotePath=false', 'diff', '--name-status', '-M', ref], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 1 << 28,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    return renames
  }
  for (const line of out.split('\n')) {
    if (!line.startsWith('R')) continue
    // R<score>\t<old>\t<new>
    const [, from, to] = line.split('\t')
    if (from && to) renames.set(to, from)
  }
  return renames
}

/**
 * Whether any commit in `base..head` touched `path`.
 *
 * A two-point diff cannot answer this: a file created and then moved away
 * inside one branch exists at neither end, so `changedPaths` never lists it,
 * and "it was not at the merge base" reads as "it never existed". The branch's
 * own history is the only place that distinction lives.
 *
 * `core.quotePath=false` for the same reason as `lastCommitDates`. Any git
 * failure — no HEAD, an unresolvable range — answers false, which is the
 * conservative reading: no evidence the branch touched it.
 */
export function touchedInRange(root, base, head, path) {
  try {
    const out = execFileSync(
      'git',
      ['-c', 'core.quotePath=false', 'log', '--format=%H', `${base}..${head}`, '--', path],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    return out.trim() !== ''
  } catch {
    return false
  }
}

/**
 * The content of `path` as the branch last held it: the newest commit in
 * `base..head` that touched it, read at that commit, or at its parent when
 * that commit is the one that removed it. Null when the branch never had it.
 *
 * This is what lets the verbatim check still run on a document captured and
 * promoted inside one branch, where the merge base has no copy to compare.
 */
export function showLastInRange(root, base, head, path) {
  let sha
  try {
    sha = execFileSync(
      'git',
      ['-c', 'core.quotePath=false', 'rev-list', '-1', `${base}..${head}`, '--', path],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
  } catch {
    return null
  }
  if (!sha) return null
  return showAtRef(root, sha, path) ?? showAtRef(root, `${sha}^`, path)
}

/**
 * File content at `ref:path`, or null when it did not exist there. Used by the
 * git-aware assertions to read a document as it stood at the base ref: a
 * missing path and an unresolvable ref are the same answer here, because the
 * caller only asks "what was there before".
 */
export function showAtRef(root, ref, path) {
  try {
    return execFileSync('git', ['show', `${ref}:${path}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    return null
  }
}
