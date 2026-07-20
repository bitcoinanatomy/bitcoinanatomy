const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 8080;
const HTTPS_PORT = 8443;
const HOST = '0.0.0.0';
const ROOT = path.join(__dirname, '..');

function lanIPs() {
    var ips = [];
    var nets = os.networkInterfaces();
    Object.keys(nets).forEach(function (name) {
        nets[name].forEach(function (net) {
            if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
        });
    });
    return ips;
}

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

function resolvePath(urlPath) {
    var clean = decodeURIComponent(urlPath.split('?')[0]);
    if (clean === '/') return path.join(ROOT, 'explorer', 'index.html');
    // Trailing slash or bare directory → index.html
    if (clean.endsWith('/')) return path.join(ROOT, clean, 'index.html');
    var candidate = path.join(ROOT, clean);
    return candidate;
}

function sendFile(res, filePath) {
    var ext = path.extname(filePath);
    fs.readFile(filePath, function (err, data) {
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

function handler(req, res) {
    var filePath = resolvePath(req.url);

    fs.stat(filePath, function (err, stat) {
        if (!err && stat.isDirectory()) {
            sendFile(res, path.join(filePath, 'index.html'));
            return;
        }
        sendFile(res, filePath);
    });
}

// Plain HTTP (works for localhost WebXR in Chrome/Firefox)
var httpServer = http.createServer(handler);
httpServer.on('error', function (err) {
    console.warn(`[HTTP] port ${PORT} unavailable (${err.code}) — continuing without it`);
});
httpServer.listen(PORT, HOST, () => {
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
        https.createServer(options, handler).listen(HTTPS_PORT, HOST, () => {
            console.log(`HTTPS server: https://localhost:${HTTPS_PORT}/`);
            lanIPs().forEach(function (ip) {
                console.log(`Quest  URL:  https://${ip}:${HTTPS_PORT}/explorer/`);
            });
            console.log('(Accept the self-signed cert warning in Quest Browser)');
        });
    }
}
