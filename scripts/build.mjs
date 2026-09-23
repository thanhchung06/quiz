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
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const outputPath = 'dist/quiz-app';

async function generateBuildInfo() {
  const timestamp = new Date().toISOString();
  const file = 'src/app/build-info.generated.ts';

  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    `// Generated during build; do not edit.\nexport const BUILD_TIMESTAMP = '${timestamp}';\n`,
  );

  console.log(`[build-info] ${timestamp}`);
}

function runNgBuild(args) {
  const ngExecutable =
    process.platform === 'win32'
      ? join('node_modules', '.bin', 'ng.cmd')
      : join('node_modules', '.bin', 'ng');

  return new Promise((resolve, reject) => {
    const ng = spawn(ngExecutable, ['build', ...args], { stdio: 'inherit' });
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
  await generateBuildInfo();

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
