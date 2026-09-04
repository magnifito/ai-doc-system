/**
 * Where the ENGINE — the `scripts/` half of this package — lives, as seen from
 * a plugin hook.
 *
 * A Claude Code plugin install is a bare git checkout: `npm install` never runs
 * in it, so the plugin's own `scripts/` cannot resolve `yaml` and a hook that
 * imported them statically would die with a module-resolution error BEFORE its
 * own `try` block could swallow it — a stack trace on every Read and Write.
 *
 * The plugin is therefore a shim. The engine that runs is the one the HOST
 * repository installed (`node_modules/@puralex/ai-doc-system`), which is also
 * the version its gate runs, so a hook can never report rules the repository
 * itself does not enforce. The plugin's own copy is the fallback, and only in a
 * checkout where `yaml` actually resolves — a development clone. When neither
 * is available the hook has nothing to run and says nothing.
 *
 * Only `node:` builtins are imported here, so loading this module can never be
 * the thing that fails.
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PACKAGE = '@puralex/ai-doc-system'

/** The plugin's own root — this file is `<root>/hooks/engine.mjs`. */
const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * The package directory whose `scripts/` a hook may import, or null when there
 * is none.
 *
 * @param {string} root the repository the hook was invoked in
 * @returns {string|null}
 */
export function engineRoot(root) {
  try {
    // Resolution is based on the host's `package.json` rather than its
    // directory, because `createRequire` treats its argument as a FILE and
    // starts the node_modules walk at the containing directory.
    return dirname(createRequire(join(root, 'package.json')).resolve(`${PACKAGE}/package.json`))
  } catch {
    // Not installed in the host repo: fall through to the plugin's own copy.
  }
  try {
    createRequire(import.meta.url).resolve('yaml')
    return PLUGIN_ROOT
  } catch {
    return null
  }
}

/**
 * Import one engine module by its package-relative path. A file URL, not a
 * path: a bare Windows path is not a valid dynamic-import specifier.
 */
export function importEngine(engine, relativePath) {
  return import(pathToFileURL(join(engine, relativePath)).href)
}
