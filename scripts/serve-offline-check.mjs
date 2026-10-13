import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const directory = resolve('dist/client');
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  // Exercise the production client as an unauthenticated player; no real Shopify calls.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
    response.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end('{"error":"login_required"}'); return;
  }
  const path = resolve(directory, `.${url.pathname === '/' ? '/offline.html' : decodeURIComponent(url.pathname)}`);
  if (!path.startsWith(directory + sep)) { response.writeHead(403); response.end(); return; }
  try {
    const content = await readFile(path);
    response.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(content);
  } catch { response.writeHead(404); response.end(); }
}).listen(5189, '127.0.0.1', () => console.log('Built offline smoke server: http://127.0.0.1:5189'));
