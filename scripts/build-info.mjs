// Shared helpers for the build/serve wrappers: writing src/app/build-info.generated.ts
// and launching the Angular CLI — both written to behave the same on Windows and Linux.
import { spawn } from 'node:child_process';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root, independent of the directory the script was started from. */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BUILD_INFO_FILE = join(ROOT, 'src', 'app', 'build-info.generated.ts');

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);

/**
 * Writes the build timestamp. On Windows the write can fail transiently with
 * EPERM/EBUSY while antivirus, Search indexing or OneDrive holds the file, or
 * permanently if the file was checked out read-only — so clear the read-only
 * flag and retry a few times before giving up.
 */
export async function writeBuildInfo() {
  const timestamp = new Date().toISOString();
  const content = `// Generated during build; do not edit.\nexport const BUILD_TIMESTAMP = '${timestamp}';\n`;
  await mkdir(dirname(BUILD_INFO_FILE), { recursive: true });

  for (let attempt = 1; ; attempt++) {
    try {
      await chmod(BUILD_INFO_FILE, 0o666).catch(() => {}); // missing file is fine
      await writeFile(BUILD_INFO_FILE, content);
      break;
    } catch (error) {
      if (!RETRYABLE.has(error.code) || attempt >= 6) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  console.log(`[build-info] ${timestamp}`);
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
