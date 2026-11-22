// npm records GitHub git dependencies as git+ssh:// in package-lock.json, which fails on build
// hosts without SSH keys (Cloudflare Pages, CI). Rewrite them to HTTPS. `--check` only reports.
import { readFileSync, writeFileSync } from 'node:fs';

const file = 'package-lock.json';
const text = readFileSync(file, 'utf8');
const fixed = text.replaceAll('git+ssh://git@github.com/', 'git+https://github.com/');
if (process.argv.includes('--check')) {
  if (fixed !== text) {
    console.error('package-lock.json contains git+ssh URLs. Run `npm run fix-lockfile`.');
    process.exit(1);
  }
  console.log('package-lock.json: OK (no SSH git URLs)');
} else {
  writeFileSync(file, fixed);
  console.log(fixed === text ? 'Nothing to fix.' : 'Rewrote git+ssh URLs to HTTPS.');
}
