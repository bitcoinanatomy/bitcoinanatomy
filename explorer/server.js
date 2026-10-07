const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

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

// Same-origin proxy for BTC Nodes API (CORS/COEP-safe for local + WebXR)
const BTCNODES_API = 'https://btcnodes.io/api';
const BTCNODES_PROXY_PREFIX = '/api/btcnodes';

function proxyBtcnodes(req, res) {
    var suffix = req.url.slice(BTCNODES_PROXY_PREFIX.length);
    if (!suffix.startsWith('/')) suffix = '/' + suffix;
    var target = new URL(BTCNODES_API + suffix);

    var upstream = https.request({
        hostname: target.hostname,
        path: target.pathname + target.search,
        method: req.method,
        headers: {
            'Accept': req.headers['accept'] || 'application/json',
            'User-Agent': 'bitcoinanatomy-explorer-local',
        },
    }, function (upRes) {
        var headers = Object.assign({
            'Content-Type': upRes.headers['content-type'] || 'application/json',
            'Cache-Control': 'no-cache',
        }, XR_HEADERS);
        if (upRes.headers['ratelimit-remaining'] != null) {
            headers['ratelimit-remaining'] = upRes.headers['ratelimit-remaining'];
        }
        if (upRes.headers['retry-after'] != null) {
            headers['retry-after'] = upRes.headers['retry-after'];
        }
        res.writeHead(upRes.statusCode || 502, headers);
        upRes.pipe(res);
    });

    upstream.on('error', function (err) {
        console.error('[btcnodes proxy]', err.message);
        res.writeHead(502, Object.assign({ 'Content-Type': 'application/json' }, XR_HEADERS));
        res.end(JSON.stringify({ error: 'btcnodes proxy failed', detail: err.message }));
    });

    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        req.pipe(upstream);
    } else {
        upstream.end();
    }
}

const ARCHIVE_FILES = {
    '/api/addrman': path.join(ROOT, 'explorer', 'data', 'btc_nodes.json'),
    '/api/bitnodes-archive': path.join(ROOT, 'explorer', 'cache', 'bitnodes_geo_cache.json'),
};
const CRAWLER_SCRIPT = path.join(ROOT, 'explorer', 'scripts', 'crawler.py');
const CRAWLER_STATUS = path.join(ROOT, 'explorer', 'cache', 'crawler_status.json');
const CRAWLER_OUT = ARCHIVE_FILES['/api/addrman'];
let crawlerProc = null;
const EPOCH_SCRIPT = path.join(ROOT, 'explorer', 'scripts', 'epoch_indexer.py');
const EPOCH_STATUS = path.join(ROOT, 'explorer', 'cache', 'epoch_status.json');
const EPOCH_OUT = path.join(ROOT, 'explorer', 'data', 'difficulty_epochs');
let epochProc = null;

function isLoopback(req) {
    const addr = req.socket.remoteAddress || '';
    return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function readJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        return null;
    }
}

function pidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return false;
    }
}

function crawlerStatus() {
    const doc = Object.assign({
        state: 'idle',
        needsNode: false,
        nodes: 0,
        visited: 0,
        handshakes: 0,
        connections: 0,
        queued: 0,
        recent: [],
    }, readJson(CRAWLER_STATUS) || {});
    if (crawlerProc && crawlerProc.exitCode == null && !crawlerProc.killed) {
        doc.state = 'running';
        doc.pid = crawlerProc.pid;
    } else if (doc.state === 'running' && !pidAlive(doc.pid)) {
        doc.state = 'done';
        doc.connections = 0;
    }
    doc.needsNode = false;
    return doc;
}

function crawlerStart(body) {
    let timeout = parseInt(body.timeout, 10) || 300;
    let workers = parseInt(body.workers, 10) || 128;
    timeout = Math.max(30, Math.min(timeout, 3600));
    workers = Math.max(1, Math.min(workers, 256));
    if (crawlerProc && crawlerProc.exitCode == null) {
        return Object.assign({ ok: false, error: 'crawler already running' }, crawlerStatus());
    }
    fs.mkdirSync(path.dirname(CRAWLER_OUT), { recursive: true });
    crawlerProc = spawn(process.env.PYTHON || 'python3', [
        CRAWLER_SCRIPT, '--timeout', String(timeout), '--max-workers', String(workers), '--out', CRAWLER_OUT,
    ], { cwd: path.join(ROOT, 'explorer') });
    crawlerProc.on('exit', function () { crawlerProc = null; });
    return Object.assign({ ok: true }, crawlerStatus());
}

function crawlerStop() {
    const status = crawlerStatus();
    const child = crawlerProc;
    if (child && child.exitCode == null) {
        child.kill('SIGTERM');
        return { ok: true, state: 'stopping' };
    }
    if (status.state === 'running' && status.pid) {
        try { process.kill(status.pid, 'SIGTERM'); } catch (err) { /* already gone */ }
        return { ok: true, state: 'stopping' };
    }
    return Object.assign({ ok: false, error: 'crawler is not running' }, status);
}

function epochStatus() {
    const doc = Object.assign({
        state: 'idle',
        tip: null,
        currentEpoch: null,
        epoch: null,
        epochIndex: 0,
        epochsTotal: 0,
        blocks: 0,
        expected: 0,
        mode: null,
        epochs: 'current',
        outDir: EPOCH_OUT,
        error: null,
    }, readJson(EPOCH_STATUS) || {});
    if (epochProc && epochProc.exitCode == null && !epochProc.killed) {
        doc.state = 'running';
        doc.pid = epochProc.pid;
    } else if (doc.state === 'running' && !pidAlive(doc.pid)) {
        doc.state = 'done';
    }
    return doc;
}

function epochStart(body) {
    const epochs = String(body.epochs || 'current').trim() || 'current';
    if (!/^[\w,-]+$/.test(epochs)) {
        return Object.assign({ ok: false, error: 'epochs must look like current, 481, or 471-481' }, epochStatus());
    }
    const useApi = body.api !== false;
    const args = [EPOCH_SCRIPT, '--epochs', epochs, '--out-dir', EPOCH_OUT, '--status-file', EPOCH_STATUS];
    if (useApi) {
        args.push('--api');
    } else {
        const rpcUrl = String(body.rpcUrl || '').trim();
        if (!rpcUrl.startsWith('http')) {
            return Object.assign({ ok: false, error: 'rpc url required when api mode is off' }, epochStatus());
        }
        args.push('--rpc-url', rpcUrl, '--rpc-user', String(body.rpcUser || ''), '--rpc-password', String(body.rpcPassword || ''));
    }
    if (epochProc && epochProc.exitCode == null) {
        return Object.assign({ ok: false, error: 'epoch indexer already running' }, epochStatus());
    }
    fs.mkdirSync(EPOCH_OUT, { recursive: true });
    fs.mkdirSync(path.dirname(EPOCH_STATUS), { recursive: true });
    epochProc = spawn(process.env.PYTHON || 'python3', args, { cwd: path.join(ROOT, 'explorer') });
    epochProc.on('exit', function () { epochProc = null; });
    return Object.assign({ ok: true }, epochStatus());
}

function epochStop() {
    const status = epochStatus();
    const child = epochProc;
    if (child && child.exitCode == null) {
        child.kill('SIGTERM');
        return { ok: true, state: 'stopping' };
    }
    if (status.state === 'running' && status.pid) {
        try { process.kill(status.pid, 'SIGTERM'); } catch (err) { /* already gone */ }
        return { ok: true, state: 'stopping' };
    }
    return Object.assign({ ok: false, error: 'epoch indexer is not running' }, status);
}

function readBody(req, cb) {
    const chunks = [];
    req.on('data', function (chunk) { chunks.push(chunk); });
    req.on('end', function () {
        try {
            cb(JSON.parse(Buffer.concat(chunks).toString() || '{}'));
        } catch (err) {
            cb({});
        }
    });
}

function sendArchive(res, filePath) {
    fs.readFile(filePath, function (err, data) {
        if (err) {
            res.writeHead(404, Object.assign({ 'Content-Type': 'application/json' }, XR_HEADERS));
            res.end(JSON.stringify({
                error: 'archive not found',
                detail: 'Run explorer/scripts/crawler.py to write cache/btc_nodes.json',
            }));
            return;
        }
        res.writeHead(200, Object.assign({
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
        }, XR_HEADERS));
        res.end(data);
    });
}

function handler(req, res) {
    var urlPath = req.url.split('?')[0];
    if (urlPath === '/api/epoch' && req.method === 'GET') {
        res.writeHead(200, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }, XR_HEADERS));
        res.end(JSON.stringify(epochStatus()));
        return;
    }
    if ((urlPath === '/api/epoch/start' || urlPath === '/api/epoch/stop') && req.method === 'POST') {
        if (!isLoopback(req)) {
            res.writeHead(403, Object.assign({ 'Content-Type': 'application/json' }, XR_HEADERS));
            res.end(JSON.stringify({ error: 'controls are localhost only' }));
            return;
        }
        readBody(req, function (body) {
            const result = urlPath.endsWith('/start') ? epochStart(body) : epochStop();
            res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, XR_HEADERS));
            res.end(JSON.stringify(result));
        });
        return;
    }
    if (urlPath === '/api/crawler' && req.method === 'GET') {
        res.writeHead(200, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }, XR_HEADERS));
        res.end(JSON.stringify(crawlerStatus()));
        return;
    }
    if ((urlPath === '/api/crawler/start' || urlPath === '/api/crawler/stop') && req.method === 'POST') {
        if (!isLoopback(req)) {
            res.writeHead(403, Object.assign({ 'Content-Type': 'application/json' }, XR_HEADERS));
            res.end(JSON.stringify({ error: 'crawler controls are localhost only' }));
            return;
        }
        readBody(req, function (body) {
            const result = urlPath.endsWith('/start') ? crawlerStart(body) : crawlerStop();
            res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, XR_HEADERS));
            res.end(JSON.stringify(result));
        });
        return;
    }
    if (ARCHIVE_FILES[urlPath]) {
        sendArchive(res, ARCHIVE_FILES[urlPath]);
        return;
    }
    if (urlPath.startsWith(BTCNODES_PROXY_PREFIX)) {
        proxyBtcnodes(req, res);
        return;
    }

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
        }).on('error', function (err) {
            console.warn(`[HTTPS] port ${HTTPS_PORT} unavailable (${err.code}) — HTTP still running`);
        });
    }
}
