// Shared helpers for the build/serve wrappers: writing the generated source files
// (src/app/build-info.generated.ts, src/app/firebase-config.generated.ts) and launching
// the Angular CLI — written to behave the same on Windows and Linux.
import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root, independent of the directory the script was started from. */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BUILD_INFO_FILE = join(ROOT, 'src', 'app', 'build-info.generated.ts');
/** The family's Firebase project + family key, committed with the code and baked into every build. */
export const FIREBASE_CONFIG = join(ROOT, 'config', 'firebase.json');
export const FIREBASE_CONFIG_FILE = join(ROOT, 'src', 'app', 'firebase-config.generated.ts');

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
  await writeFirebaseConfig();
}

const FIREBASE_KEYS = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'appId', 'familyKey'];

/**
 * Bakes config/firebase.json (committed with the code) into the app, so every
 * build of it — Windows or WSL, any address, the installed phone app — talks
 * to the family's Firebase database. Without the file the values are empty and
 * the app says it isn't configured.
 */
export async function writeFirebaseConfig() {
  let config = {};
  try {
    config = JSON.parse(await readFile(FIREBASE_CONFIG, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Cannot read ${FIREBASE_CONFIG}: ${error.message}`);
  }
  const values = Object.fromEntries(FIREBASE_KEYS.map((key) => [key, typeof config[key] === 'string' ? config[key].trim() : '']));
  await writeGenerated(
    FIREBASE_CONFIG_FILE,
    `// Generated from config/firebase.json during build; do not edit.\n` +
      `export const FIREBASE_CONFIG: Record<'${FIREBASE_KEYS.join("' | '")}', string> = ${JSON.stringify(values, null, 2)};\n`,
  );
  console.log(`[firebase-config] ${values.databaseURL ? `project ${values.projectId}` : 'none (no config/firebase.json)'}`);
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
