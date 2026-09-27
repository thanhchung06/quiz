import { watch } from 'node:fs';
import { join } from 'node:path';
import { ROOT, spawnNg, writeBuildInfo } from './build-info.mjs';

await writeBuildInfo();

let debounceTimer;

const watcher = watch(
  join(ROOT, 'src'),
  { recursive: true, encoding: 'utf8' },
  (_event, filename) => {
    if (!filename) return;

    const normalized = filename.replaceAll('\\', '/');

    // Prevent the generated files (build-info, sync-defaults) from triggering an infinite loop.
    if (normalized.endsWith('.generated.ts')) return;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      writeBuildInfo().catch(console.error);
    }, 100);
  },
);

const angular = spawnNg(process.argv.slice(2));

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