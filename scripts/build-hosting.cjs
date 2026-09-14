const fs = require('node:fs');
const path = require('node:path');

const ASSETS = Object.freeze([
  'index.html', 'reminder-system.html', 'reminder-system.js', 'account-linking.js',
  'privacy-policy.html', 'data-deletion.html', 'favicon.png'
]);

// Stage an explicit allowlist: never publish rules, test fixtures, or credentials.
function buildHosting(root = path.join(__dirname, '..')) {
  const output = path.join(root, '.firebase-hosting-public');
  for (const asset of ASSETS) {
    const stat = fs.lstatSync(path.join(root, asset));
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Expected regular asset: ' + asset);
  }
  if (fs.existsSync(output)) {
    const stat = fs.lstatSync(output);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe staging directory');
    for (const entry of fs.readdirSync(output, { withFileTypes: true })) {
      if (!ASSETS.includes(entry.name) || !entry.isFile() || entry.isSymbolicLink()) {
        throw new Error('Unexpected staging entry; review it manually: ' + entry.name);
      }
    }
  } else fs.mkdirSync(output);
  for (const asset of ASSETS) fs.copyFileSync(path.join(root, asset), path.join(output, asset));
  return output;
}

if (require.main === module) console.log('Staged hosting assets: ' + buildHosting());
module.exports = { ASSETS, buildHosting };
