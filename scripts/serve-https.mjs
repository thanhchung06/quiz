// Serves the production build (dist/quiz-app/browser) over HTTPS on the local
// network, so a phone on the same Wi-Fi can install the app with offline
// support (service workers only run on HTTPS or localhost).
//
//   npm run serve:https                 -> port 8443
//   npm run serve:https -- --port 9443
//
// Certificate: certs/cert.pem + certs/key.pem, made with mkcert for this PC's
// LAN IP (see the message printed when they are missing). The phone must trust
// mkcert's root CA (`mkcert -CAROOT` → rootCA.pem).
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:https';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { ROOT } from './build-info.mjs';

const WEB_ROOT = join(ROOT, 'dist', 'quiz-app', 'browser');
const CERT = join(ROOT, 'certs', 'cert.pem');
const KEY = join(ROOT, 'certs', 'key.pem');
const portArg = process.argv.indexOf('--port');
const PORT = portArg > -1 ? Number(process.argv[portArg + 1]) : 8443;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
}

async function loadCertificate() {
  try {
    return { cert: await readFile(CERT), key: await readFile(KEY) };
  } catch {
    const ip = lanAddresses()[0] ?? '192.168.1.10';
    console.error(`Missing certs/cert.pem and certs/key.pem.

Create them once with mkcert (https://github.com/FiloSottile/mkcert), from the repo folder:
  mkcert -install
  mkcert -cert-file certs/cert.pem -key-file certs/key.pem ${ip} localhost 127.0.0.1

Then copy the file "rootCA.pem" from the folder shown by \`mkcert -CAROOT\` to the phone and
install it as a trusted CA certificate.`);
    process.exit(1);
  }
}

/** Only a production build (npm run build) contains the service worker that makes the app installable offline. */
async function checkBuild() {
  const missing = [];
  for (const file of ['index.html', 'ngsw-worker.js', 'ngsw.json']) {
    if (!(await stat(join(WEB_ROOT, file)).catch(() => undefined))) missing.push(file);
  }
  if (missing.length) {
    console.error(`No production build in ${WEB_ROOT} (missing ${missing.join(', ')}).
Run "npm run build" first, then "npm run serve:https" again.`);
    process.exit(1);
  }
}

async function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const candidate = normalize(join(WEB_ROOT, decoded));
  if (candidate !== WEB_ROOT && !candidate.startsWith(WEB_ROOT + sep)) return undefined; // no ../ escapes
  try {
    const info = await stat(candidate);
    if (info.isFile()) return candidate;
    if (info.isDirectory()) {
      const index = join(candidate, 'index.html');
      if ((await stat(index).catch(() => undefined))?.isFile()) return index;
    }
  } catch {
    /* not found */
  }
  return undefined;
}

await checkBuild();

const server = createServer(await loadCertificate(), async (req, res) => {
  try {
    let file = await resolveFile(req.url ?? '/');
    // SPA fallback: app routes like /quiz-bank are served index.html; missing assets stay 404.
    if (!file && !extname((req.url ?? '').split('?')[0])) file = join(WEB_ROOT, 'index.html');
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    const name = file.slice(WEB_ROOT.length).replaceAll('\\', '/');
    // index.html and the service-worker files must always be revalidated so the app sees updates;
    // Angular's hashed bundles can be cached for good.
    const cache = /^\/(index\.html|ngsw\.json|ngsw-worker\.js|safety-worker\.js|worker-basic\.min\.js|manifest\.webmanifest)$/.test(name)
      ? 'no-cache'
      : /-[A-Z0-9]{8}\.(js|css)$/.test(name)
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600';
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': cache });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  } catch (error) {
    res.writeHead(500).end(String(error));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Serving ${WEB_ROOT} over HTTPS on port ${PORT}`);
  for (const ip of lanAddresses()) console.log(`  https://${ip}:${PORT}`);
  console.log(`  https://localhost:${PORT}`);
  console.log('Open the LAN address on the phone (same Wi-Fi). Stop with Ctrl+C.');
});
