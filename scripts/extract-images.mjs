// Downloads every internet image referenced by a quiz import file into the
// app's asset folder and rewrites the file to point at the local copy, so the
// pictures keep working offline (the service worker prefetches
// public/assets/images/**).
//
//   npm run extractI -- path/to/import_file.json [--dir name] [--dry-run]
//
// - Looks at quizzes[].imageUrl, passages[].imageUrl,
//   passages[].questions[].imageUrl and every choices[].imageUrl of those
//   questions; only http(s):// (and //host) links are
//   downloaded — local asset paths and data: URLs are left alone.
// - Files go to public/assets/images/<dir>/, where <dir> defaults to the
//   import file's name (e.g. "toan-lop-2" for toan-lop-2.json); the JSON gets
//   "assets/images/<dir>/<file>" in their place.
// - The original file is kept as <file>.bak before it's rewritten. Re-running
//   is safe: links already rewritten are local, and files already on disk
//   aren't downloaded again.
//
// Plain Node (18+) with no dependencies, and every path goes through
// node:path, so it runs the same on Windows and Linux.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_ROOT = join(PROJECT_ROOT, 'public', 'assets', 'images');
const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

/** Content type → file extension; kept to what the service worker's quiz-images group caches (ngsw-config.json). */
const EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
};

function usage(message) {
  if (message) console.error(`Lỗi: ${message}\n`);
  console.error('Cách dùng: npm run extractI -- <tệp-nhập.json> [--dir <tên-thư-mục>] [--dry-run]');
  process.exit(1);
}

function parseArgs(argv) {
  const options = { file: undefined, dir: undefined, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--dir') options.dir = argv[++i];
    else if (arg === '-h' || arg === '--help') usage();
    else if (arg.startsWith('-')) usage(`không hiểu tùy chọn "${arg}"`);
    else if (!options.file) options.file = arg;
    else usage(`thừa tham số "${arg}"`);
  }
  if (!options.file) usage('thiếu đường dẫn tệp nhập');
  if (options.dir === '') usage('--dir cần một tên thư mục');
  return options;
}

/** "Toán lớp 2 (bản 1)" → "toan-lop-2-ban-1": safe as a folder/file name on every OS and in a URL. */
function slug(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function isInternetUrl(value) {
  return typeof value === 'string' && /^(https?:)?\/\//i.test(value.trim());
}

/** Every object in the package that can carry an `imageUrl`, with a label for messages. */
function imageHolders(pkg) {
  const holders = [];
  const addQuestion = (q, label) => {
    holders.push({ owner: q, label });
    (q?.choices ?? []).forEach((c, k) => holders.push({ owner: c, label: `${label}.choices[${k}]` }));
  };
  (pkg.quizzes ?? []).forEach((q, i) => addQuestion(q, `quizzes[${i}]`));
  (pkg.passages ?? []).forEach((p, i) => {
    holders.push({ owner: p, label: `passages[${i}]` });
    (p.questions ?? []).forEach((q, j) => addQuestion(q, `passages[${i}].questions[${j}]`));
  });
  return holders.filter((h) => h.owner && typeof h.owner === 'object' && isInternetUrl(h.owner.imageUrl));
}

function urlHash(url) {
  return createHash('sha1').update(url).digest('hex').slice(0, 8);
}

/** Readable, collision-free local name: the link's own file name + a short hash of the full URL. */
function localFileName(url, contentType) {
  const pathname = new URL(url).pathname;
  const original = decodeURIComponent(basename(pathname));
  const ownExt = extname(original).toLowerCase();
  const ext = EXTENSIONS[contentType] ?? (Object.values(EXTENSIONS).includes(ownExt) ? ownExt : undefined);
  if (!ext) throw new Error(`không phải định dạng ảnh được hỗ trợ (${contentType || 'không rõ'})`);
  const stem = slug(original.slice(0, original.length - ownExt.length)) || 'hinh';
  return `${stem}-${urlHash(url)}${ext}`;
}

/** A file saved from this exact URL by an earlier run, found by its URL-hash suffix — so re-runs don't download again. */
async function findExisting(targetDir, url) {
  const suffix = `-${urlHash(url)}.`;
  try {
    return (await readdir(targetDir)).find((name) => name.includes(suffix));
  } catch {
    return undefined; // folder doesn't exist yet
  }
}

async function download(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    // Some hosts (e.g. Wikimedia) reject requests without a User-Agent.
    headers: { 'User-Agent': 'luyen-tap-moi-ngay-image-extractor/1.0 (offline quiz app)' },
  });
  if (!response.ok) throw new Error(`máy chủ trả về ${response.status} ${response.statusText}`);
  const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (contentType && !contentType.startsWith('image/')) throw new Error(`không phải ảnh (${contentType})`);
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) throw new Error(`ảnh quá lớn (${Math.round(declared / 1024 / 1024)} MB, tối đa 10 MB)`);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > MAX_BYTES) throw new Error('ảnh quá lớn (tối đa 10 MB)');
  return { data, contentType };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  // npm runs scripts from the project root; INIT_CWD is where the user actually typed the command.
  const inputPath = resolve(process.env.INIT_CWD ?? process.cwd(), options.file);

  let pkg;
  try {
    pkg = JSON.parse(await readFile(inputPath, 'utf8'));
  } catch (error) {
    usage(`không đọc được "${inputPath}" — ${error.code === 'ENOENT' ? 'không tìm thấy tệp' : error.message}`);
  }

  const folder = slug(options.dir ?? basename(inputPath, extname(inputPath))) || 'nhap';
  const targetDir = join(ASSET_ROOT, folder);
  const holders = imageHolders(pkg);
  console.log(`Tệp: ${inputPath}`);
  console.log(`Tìm thấy ${holders.length} ảnh từ internet. Thư mục lưu: ${targetDir}${options.dryRun ? ' (chạy thử, không ghi gì)' : ''}\n`);
  if (holders.length === 0) return;

  const byUrl = new Map(); // url → local asset path (or Error), so a picture used many times downloads once
  let downloaded = 0;
  let reused = 0;
  const failures = [];

  for (const { owner, label } of holders) {
    const raw = owner.imageUrl.trim();
    const url = raw.startsWith('//') ? `https:${raw}` : raw;

    if (!byUrl.has(url)) {
      try {
        if (options.dryRun) {
          byUrl.set(url, `assets/images/${folder}/…`);
        } else {
          let fileName = await findExisting(targetDir, url);
          if (fileName) {
            reused++;
          } else {
            const { data, contentType } = await download(url);
            fileName = localFileName(url, contentType);
            await mkdir(targetDir, { recursive: true });
            await writeFile(join(targetDir, fileName), data);
            downloaded++;
          }
          // Always forward slashes: this is a URL path inside the app, not an OS path.
          byUrl.set(url, `assets/images/${folder}/${fileName}`);
        }
      } catch (error) {
        const reason = error?.name === 'TimeoutError' ? 'quá thời gian chờ' : (error?.cause?.code ?? error.message);
        byUrl.set(url, new Error(reason));
      }
    }

    const result = byUrl.get(url);
    if (result instanceof Error) {
      failures.push(`${label}: ${url}\n    → ${result.message}`);
      console.log(`✗ ${label}: ${result.message}`);
      continue;
    }
    console.log(`✓ ${label}: ${result}`);
    if (!options.dryRun) owner.imageUrl = result;
  }

  if (!options.dryRun) {
    const backupPath = `${inputPath}.bak`;
    await copyFile(inputPath, backupPath);
    await writeFile(inputPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
    console.log(`\nĐã tải ${downloaded} ảnh mới, dùng lại ${reused} ảnh đã có. Đã cập nhật tệp (bản gốc: ${backupPath}).`);
    console.log('Nhớ build lại ứng dụng (npm run build) để ảnh mới được đóng gói cho chế độ ngoại tuyến.');
  }

  if (failures.length) {
    console.log(`\n${failures.length} ảnh không tải được — giữ nguyên link internet:\n  ${failures.join('\n  ')}`);
    process.exitCode = 2;
  }
}

await main();
