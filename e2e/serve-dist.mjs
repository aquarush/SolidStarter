// Minimal static server for dist/ that applies the Cloudflare Pages `_headers` rules,
// so the browser test exercises the exact production Content-Security-Policy.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
};

/** Parse the `_headers` file into [{ pattern: RegExp, headers: [name, value][] }]. */
function parseHeaders(text) {
  const rules = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      const glob = line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      rules.push({ pattern: new RegExp(`^${glob}$`), headers: [] });
    } else {
      const idx = line.indexOf(':');
      rules.at(-1).headers.push([line.slice(0, idx).trim(), line.slice(idx + 1).trim()]);
    }
  }
  return rules;
}

export async function serveDist(port = 4180, root = resolve('dist')) {
  const rules = parseHeaders(await readFile(join(root, '_headers'), 'utf8'));
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = normalize(join(root, path === '/' ? 'index.html' : path));
    if (!file.startsWith(root) || file.endsWith('_headers')) {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = await readFile(file);
      for (const rule of rules) {
        if (rule.pattern.test(path)) for (const [k, v] of rule.headers) res.setHeader(k, v);
      }
      // upgrade-insecure-requests would rewrite http://localhost asset URLs; drop it for the local test only.
      const csp = res.getHeader('Content-Security-Policy');
      if (csp) res.setHeader('Content-Security-Policy', String(csp).replace(/;\s*upgrade-insecure-requests/, ''));
      res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
      res.writeHead(200).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${port}/`, close: () => server.close() };
}
