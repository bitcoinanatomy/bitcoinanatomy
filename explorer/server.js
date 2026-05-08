const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const HTTPS_PORT = 8443;
const ROOT = path.join(__dirname, '..');

const MIME = {
    '.html': 'text/html',
    '.css':  'text/css',
    '.js':   'application/javascript',
    '.json': 'application/json',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.ico':  'image/x-icon',
};

// Headers required for WebXR to work across browsers
const XR_HEADERS = {
    'Permissions-Policy': 'xr-spatial-tracking=(*)',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
};

function handler(req, res) {
    const urlPath = req.url.split('?')[0];
    const filePath = path.join(ROOT, urlPath === '/' ? 'explorer/network.html' : urlPath);
    const ext = path.extname(filePath);

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
        }
        res.writeHead(200, Object.assign({
            'Content-Type': MIME[ext] || 'application/octet-stream',
            'Cache-Control': 'no-cache',
        }, XR_HEADERS));
        res.end(data);
    });
}

// Always start plain HTTP (works for localhost WebXR in Chrome/Firefox)
http.createServer(handler).listen(PORT, () => {
    console.log(`HTTP  server: http://localhost:${PORT}/`);
    console.log(`Open  http://localhost:${PORT}/explorer/network.html`);
    console.log('');
    console.log('Note: WebXR requires HTTPS when accessing from a headset over LAN.');
    console.log(`      Start HTTPS with: node server.js --https`);
    console.log(`      Then open: https://<your-ip>:${HTTPS_PORT}/explorer/network.html`);
    console.log('      (Accept the self-signed cert warning in your headset browser)');
});

// Start HTTPS if --https flag is passed or ssl/ certs exist
const sslKey  = path.join(ROOT, 'ssl', 'server.key');
const sslCert = path.join(ROOT, 'ssl', 'server.crt');
const wantsHttps = process.argv.includes('--https') || (fs.existsSync(sslKey) && fs.existsSync(sslCert));

if (wantsHttps) {
    if (!fs.existsSync(sslKey) || !fs.existsSync(sslCert)) {
        console.error('\n[HTTPS] ssl/server.key or ssl/server.crt not found.');
        console.error('Generate them with:');
        console.error('  mkdir ssl');
        console.error('  openssl req -x509 -newkey rsa:4096 -keyout ssl/server.key -out ssl/server.crt -days 365 -nodes -subj "/CN=localhost"');
    } else {
        const options = {
            key:  fs.readFileSync(sslKey),
            cert: fs.readFileSync(sslCert),
        };
        https.createServer(options, handler).listen(HTTPS_PORT, () => {
            console.log(`HTTPS server: https://localhost:${HTTPS_PORT}/`);
            console.log(`Open  https://localhost:${HTTPS_PORT}/network.html`);
        });
    }
}
