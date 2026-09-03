/**
 * The one reader for `--flag <value>` arguments.
 *
 * Every command used to carry its own three-line copy that returned
 * `argv[index + 1]` and asked no questions, so `check --base` at the end of a
 * line read as `base: undefined` and silently skipped the history-aware rules —
 * a green gate that checked less than it said. `verify --only` dropped its
 * filter and verified the whole tree, `check --format` fell back to text.
 *
 * A flag that is present must have a value. `--base --json` is the same
 * mistake as a trailing `--base`, so a next token that is itself a flag
 * (starts with `--`) is refused rather than swallowed as the value. A single
 * dash is allowed: `--title "-1 experiment"` is free text, not a flag.
 */

/** A flag was given without a value. Callers turn this into an exit-2 usage error. */
export class UsageError extends Error {}

/**
 * @param {string[]} argv the arguments to read (`process.argv` is fine — the
 *   flag is found by name, not by position)
 * @param {string} name the flag, including its dashes
 * @returns {string|undefined} the value, or undefined when the flag is absent
 * @throws {UsageError} when the flag is present but its value is not
 */
export function flagValue(argv, name) {
  const index = argv.indexOf(name)
  if (index === -1) return undefined
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new UsageError(`${name} needs a value`)
  return value
}

/**
 * Read several value flags at once, exiting 2 with a one-line usage error on
 * the first one that is missing its value. `command` is the word the user
 * typed (`check`, `verify`, …), so the message names what they ran.
 *
 * The error is plain text on stderr even under `--json`: a caller that cannot
 * parse its own command line has no output contract yet.
 *
 * @param {string} command
 * @param {string[]} argv
 * @param {string[]} names
 * @returns {Record<string, string|undefined>} keyed by flag name, dashes included
 */
export function flagValues(command, argv, names) {
  const out = {}
  try {
    for (const name of names) out[name] = flagValue(argv, name)
  } catch (error) {
    if (!(error instanceof UsageError)) throw error
    console.error(`${command}: ${error.message}`)
    process.exit(2)
  }
  return out
}
