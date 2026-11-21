/**
 * Vercel build step.
 * Takes your original Apps Script pages (apps-script/Index.html and Admin.html),
 * adds the gas-shim.js line, and writes them to public/index.html and public/admin.html.
 * Your original files are never modified.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'apps-script');
const outDir = path.join(root, 'public');
fs.mkdirSync(outDir, { recursive: true });

function findSource(names) {
  for (const n of names) {
    const p = path.join(srcDir, n);
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Missing file in apps-script/: ' + names.join(' or '));
}

function build(names, outName, extra) {
  let html = fs.readFileSync(findSource(names), 'utf8');
  const tag = '<script src="/gas-shim.js"></script>';
  if (!/<head[^>]*>/i.test(html)) throw new Error(names[0] + ' has no <head> tag');
  html = html.replace(/<head[^>]*>/i, function (m) { return m + '\n' + tag; });
  if (extra) html = extra(html);
  fs.writeFileSync(path.join(outDir, outName), html);
  console.log('Built public/' + outName);
}

build(['Index.html', 'index.html'], 'index.html');
build(['Admin.html', 'admin.html'], 'admin.html', function (html) {
  // On Vercel the customer site is "/" (not the Apps Script ?page= URL)
  return html.replace("$('customerSiteLink').href=location.pathname;", "$('customerSiteLink').href='/';");
});
