// Shared helpers for the build/serve wrappers: writing the generated source files
// (src/app/build-info.generated.ts, src/app/sync-defaults.generated.ts) and launching
// the Angular CLI — written to behave the same on Windows and Linux.
import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root, independent of the directory the script was started from. */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BUILD_INFO_FILE = join(ROOT, 'src', 'app', 'build-info.generated.ts');
/** Local, git-ignored sync settings baked into the build as defaults: { "endpointUrl": "...", "sharedSecret": "..." }. */
export const SYNC_DEFAULTS_CONFIG = join(ROOT, 'config', 'sync-defaults.json');
export const SYNC_DEFAULTS_FILE = join(ROOT, 'src', 'app', 'sync-defaults.generated.ts');

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);

/**
 * Writes the build timestamp. On Windows the write can fail transiently with
 * EPERM/EBUSY while antivirus, Search indexing or OneDrive holds the file, or
 * permanently if the file was checked out read-only — so clear the read-only
 * flag and retry a few times before giving up.
 */
export async function writeBuildInfo() {
  const timestamp = new Date().toISOString();
  await writeGenerated(BUILD_INFO_FILE, `// Generated during build; do not edit.\nexport const BUILD_TIMESTAMP = '${timestamp}';\n`);
  console.log(`[build-info] ${timestamp}`);
  await writeSyncDefaults();
}

/**
 * Bakes config/sync-defaults.json (git-ignored — it holds the sync secret) into
 * the app, so every copy of it (any address, the installed phone app) starts
 * with the family's sync endpoint and secret filled in. Without the file the
 * defaults are empty and each device is configured on the Sync screen.
 */
export async function writeSyncDefaults() {
  let config = {};
  try {
    config = JSON.parse(await readFile(SYNC_DEFAULTS_CONFIG, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Cannot read ${SYNC_DEFAULTS_CONFIG}: ${error.message}`);
  }
  const defaults = {
    endpointUrl: typeof config.endpointUrl === 'string' ? config.endpointUrl.trim() : '',
    sharedSecret: typeof config.sharedSecret === 'string' ? config.sharedSecret.trim() : '',
  };
  await writeGenerated(
    SYNC_DEFAULTS_FILE,
    `// Generated from config/sync-defaults.json during build; do not edit or commit.\n` +
      `export const SYNC_DEFAULTS: { endpointUrl: string; sharedSecret: string } = ${JSON.stringify(defaults, null, 2)};\n`,
  );
  console.log(`[sync-defaults] ${defaults.endpointUrl ? 'endpoint + secret from config/sync-defaults.json' : 'none (no config/sync-defaults.json)'}`);
}

async function writeGenerated(file, content) {
  await mkdir(dirname(file), { recursive: true });
  for (let attempt = 1; ; attempt++) {
    try {
      await chmod(file, 0o666).catch(() => {}); // missing file is fine
      await writeFile(file, content);
      return;
    } catch (error) {
      if (!RETRYABLE.has(error.code) || attempt >= 6) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
}

/**
 * Runs the Angular CLI through `node …/@angular/cli/bin/ng.js` instead of the
 * `node_modules/.bin/ng(.cmd)` shim: Node refuses to spawn a `.cmd` file
 * without a shell on Windows (`spawn EINVAL` since Node 18.20.2 / 20.12.2),
 * and going through node directly also avoids shell quoting of the arguments.
 */
export function spawnNg(args) {
  const ngJs = join(ROOT, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');
  return spawn(process.execPath, [ngJs, ...args], { stdio: 'inherit', cwd: ROOT });
}
