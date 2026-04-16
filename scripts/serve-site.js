#!/usr/bin/env node
/**
 * Tiny zero-dependency static server for the marketing site. Use this during
 * design work so you can iterate on public/ without standing up Mongo.
 *
 *   node scripts/serve-site.js          # serves on :4455
 *   PORT=5000 node scripts/serve-site.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 4455;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

http
  .createServer((req, res) => {
    let reqPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (reqPath.endsWith('/')) reqPath += 'index.html';

    let filePath = path.join(ROOT, reqPath);
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(400);
      return res.end('bad path');
    }

    // resolve /docs → /docs.html
    if (!fs.existsSync(filePath) && fs.existsSync(filePath + '.html')) {
      filePath += '.html';
    }

    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404, {'Content-Type': 'text/plain'});
        return res.end('404 not found');
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(filePath).pipe(res);
    });
  })
  .listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`statehash.io site → http://localhost:${PORT}`);
    // eslint-disable-next-line no-console
    console.log(`  /           landing page`);
    // eslint-disable-next-line no-console
    console.log(`  /docs       API documentation`);
  });
