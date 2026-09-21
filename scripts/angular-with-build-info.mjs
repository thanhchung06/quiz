import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { writeFile } from 'node:fs/promises';

const generatedFile = 'src/app/build-info.generated.ts';

async function generateBuildInfo() {
  const timestamp = new Date().toISOString();

  await writeFile(
    generatedFile,
    `// Generated automatically; do not edit.
export const BUILD_TIMESTAMP = '${timestamp}';
`,
  );

  console.log(`[build-info] ${timestamp}`);
}

await generateBuildInfo();

let debounceTimer;

const watcher = watch(
  'src',
  { recursive: true, encoding: 'utf8' },
  (_event, filename) => {
    if (!filename) return;

    const normalized = filename.replaceAll('\\', '/');

    // Prevent the generated file from triggering an infinite loop.
    if (normalized.endsWith('build-info.generated.ts')) return;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      generateBuildInfo().catch(console.error);
    }, 100);
  },
);

const ngExecutable =
  process.platform === 'win32'
    ? 'node_modules\\.bin\\ng.cmd'
    : './node_modules/.bin/ng';

const ngArguments = process.argv.slice(2);

const angular = spawn(ngExecutable, ngArguments, {
  stdio: 'inherit',
});

angular.on('exit', (code) => {
  watcher.close();
  process.exit(code ?? 0);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    watcher.close();
    angular.kill(signal);
  });
}