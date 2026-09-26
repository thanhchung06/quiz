// Production build wrapper.
//
// `ng build` writes its output with parallel fs.copyFile/fs.cp calls, which
// take an OS fast-path (copy_file_range / CopyFileEx) that several common
// setups reject with a spurious EPERM/EBUSY mid-build: WSL 9p/drvfs mounts,
// Windows folders under antivirus or Windows Search indexing, and
// OneDrive-synced folders. A plain read/write copy avoids that fast path.
//
// So: build to a throwaway temp directory (always on a well-behaved local
// filesystem), then copy the result into the real output path ourselves
// using plain read/write instead of the OS copy fast-path.
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, spawnNg, writeBuildInfo } from './build-info.mjs';

const outputPath = join(ROOT, 'dist', 'quiz-app');

function runNgBuild(args) {
  return new Promise((resolve, reject) => {
    const ng = spawnNg(['build', ...args]);
    ng.on('error', reject);
    ng.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ng build exited with code ${code}`));
    });
  });
}

async function copyFileWithRetry(src, dest, attempt = 1) {
  try {
    const data = await readFile(src);
    await writeFile(dest, data);
  } catch (error) {
    if (attempt >= 5) throw error;
    await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    await copyFileWithRetry(src, dest, attempt + 1);
  }
}

async function copyRecursive(src, dest) {
  const entry = await stat(src);

  if (entry.isDirectory()) {
    await mkdir(dest, { recursive: true });
    const children = await readdir(src);
    for (const child of children) {
      await copyRecursive(join(src, child), join(dest, child));
    }
  } else {
    await copyFileWithRetry(src, dest);
  }
}

async function main() {
  await writeBuildInfo();

  const tempDir = await mkdtemp(join(tmpdir(), 'quiz-app-build-'));

  try {
    await runNgBuild(['--output-path', tempDir, ...process.argv.slice(2)]);

    await rm(outputPath, { recursive: true, force: true });
    await copyRecursive(tempDir, outputPath);

    console.log(`[build] output copied to ${outputPath}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

await main();
