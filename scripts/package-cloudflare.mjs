// Builds nothing; zips the contents of dist/ (files at the zip root) for Cloudflare Pages "Upload assets".
//   npm run build && npm run package:cloudflare
import { execFileSync } from 'node:child_process';
execFileSync('python3', ['-c', `
import os, zipfile
with zipfile.ZipFile('flare.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk('dist'):
        for f in files:
            p = os.path.join(root, f)
            z.write(p, os.path.relpath(p, 'dist'))
`], { stdio: 'inherit' });
console.log('Wrote flare.zip');
