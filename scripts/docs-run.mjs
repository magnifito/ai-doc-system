/** Shared run-direct guard for scripts that are both importable and executable. */
import { pathToFileURL } from 'node:url'

/**
 * True when the module at `moduleUrl` is the script Node was asked to run.
 * String comparison against `file://${argv[1]}` is not enough: on Windows
 * `argv[1]` is a drive-letter path whose URL form differs, so the guard would
 * never fire and the CLI tests would pass everywhere except where they run.
 */
export function runDirect(moduleUrl) {
  return Boolean(process.argv[1]) && moduleUrl === pathToFileURL(process.argv[1]).href
}
