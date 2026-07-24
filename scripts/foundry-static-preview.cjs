const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(process.argv[2] || ".");
const port = Number(process.argv[3] || 0);
const ownershipToken = process.argv[4] || "foundry-static-preview";
const mime = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

// A static project is served from its own folder, but generated pages routinely reference assets
// at the web root ("/foundry-uploads/logo.png") while the file itself sits under a framework-style
// asset folder. Serving only the literal path made every such reference a 404 and a visibly broken
// image. Resolve the literal path first, then the conventional asset roots.
const assetRoots = ["", "public", "static", "assets"];

function resolveCandidates(relative) {
  const candidates = [];
  for (const base of assetRoots) {
    const target = path.resolve(root, base, relative);
    if (target === root || target.startsWith(`${root}${path.sep}`)) candidates.push(target);
  }
  return candidates;
}

function firstReadable(candidates, done) {
  const next = (index) => {
    if (index >= candidates.length) {
      done(null);
      return;
    }
    const candidate = candidates[index];
    fs.stat(candidate, (statError, stats) => {
      if (statError) {
        next(index + 1);
        return;
      }
      const file = stats.isDirectory() ? path.join(candidate, "index.html") : candidate;
      fs.readFile(file, (readError, content) => {
        if (readError) next(index + 1);
        else done({ file, content });
      });
    });
  };
  next(0);
}

http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidates = resolveCandidates(relative);
  if (!candidates.length) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  firstReadable(candidates, (found) => {
    if (!found) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8", "x-foundry-preview": ownershipToken }).end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": mime[path.extname(found.file).toLowerCase()] || "application/octet-stream", "cache-control": "no-store", "x-foundry-preview": ownershipToken });
    response.end(found.content);
  });
}).listen(port, "127.0.0.1");
