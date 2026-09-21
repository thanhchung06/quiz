import { mkdir, writeFile } from 'node:fs/promises';

const output = 'src/app/build-info.generated.ts';

await mkdir('src/app', { recursive: true });
await writeFile(
  output,
  `// Generated during build; do not edit.
export const BUILD_TIMESTAMP = '${new Date().toISOString()}';
`,
);

console.log(`Generated ${output}`);