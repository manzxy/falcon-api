const express = require('express');
const chalk = require('chalk');
const fs = require('fs');
const cors = require('cors');
const path = require('path');
const axios = require('axios');

require("./function.js");

const app = express();
const PORT = process.env.PORT || 8080;

// =========================
// DISCORD WEBHOOK
// =========================
const WEBHOOK_URL = 'https://discord.com/api/webhooks/1396122030163628112/-vEj4HjREjbaOVXDu5932YjeHpTkjNSKyUKugBFF9yVCBeQSrdgK8qM3HNxVYTOD5BYP';

// =========================
// TELEGRAM NOTIFICATION
// =========================
const TELEGRAM_BOT_TOKEN = '8364129852:AAEjCrqQBI7f1OpVkhnxOBhcww9yegoJ-EU';
const TELEGRAM_CHAT_ID = '7019305587';

// =========================
// LOG BUFFER
// =========================
let logBuffer = [];

// =========================
// SEND DISCORD LOG (BATCH)
// =========================
setInterval(() => {
    if (logBuffer.length === 0) return;

    const combinedLogs = logBuffer.join('\n');
    logBuffer = [];

    const payload = `\`\`\`ansi\n${combinedLogs}\n\`\`\``;
    axios.post(WEBHOOK_URL, { content: payload }).catch(() => {});
}, 2000);

// =========================
// LOG QUEUE
// =========================
function queueLog({ method, status, url, duration, error = null }) {
    let colorCode =
        status >= 500 ? '[2;31m' :
        status >= 400 ? '[2;31m' :
        status === 304 ? '[2;34m' :
        '[2;32m';

    let line = `${colorCode}[${method}] ${status} ${url} - ${duration}ms[0m`;
    if (error) line += `\n[2;31m[ERROR] ${error}[0m`;

    logBuffer.push(line);
}

// =========================
// TELEGRAM NOTIFY (RINGKAS)
// =========================
async function notifyTelegram(req, status, duration) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
    const msg =
`📡 *API Request*
• Method : ${req.method}
• Path   : ${req.originalUrl}
• Status : ${status}
• Time   : ${duration}ms
• IP     : ${req.ip}`;

    axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: TELEGRAM_CHAT_ID,
        text: msg,
        parse_mode: "Markdown"
    }).catch(() => {});
}

// =========================
// COOLDOWN SYSTEM
// =========================
let requestCount = 0;
let isCooldown = false;

setInterval(() => requestCount = 0, 1000);

app.use((req, res, next) => {
    if (isCooldown) {
        queueLog({ method: req.method, status: 503, url: req.originalUrl, duration: 0 });
        return res.status(503).json({ error: 'Server cooldown' });
    }

    requestCount++;
    if (requestCount > 10) {
        isCooldown = true;
        setTimeout(() => isCooldown = false, 60000);
        return res.status(503).json({ error: 'Too many requests' });
    }
    next();
});

app.enable("trust proxy");
app.set("json spaces", 2);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cors());

// =========================
// LOAD SETTINGS
// =========================
const settingsPath = path.join(__dirname, './assets/settings.json');
let settings;
try {
    settings = JSON.parse(fs.readFileSync(settingsPath));
    console.log(chalk.green('✅ Settings loaded successfully'));
} catch (error) {
    console.error(chalk.red('❌ Failed to load settings.json:'), error.message);
    settings = {
        apiSettings: { creator: 'Manzxy', apikey: '' },
        version: '1.0.0'
    };
}
global.apikey = settings.apiSettings?.apikey || '';
global.totalreq = 0;

// =========================
// LOGGER MIDDLEWARE
// =========================
app.use((req, res, next) => {
    console.log(chalk.bgHex('#FFFF99').hex('#333')(` Request: ${req.path} `));
    global.totalreq++;

    const start = Date.now();
    const oldJson = res.json;

    res.json = function (data) {
        return oldJson.call(this, {
            creator: settings.apiSettings?.creator || 'Manzxy',
            ...data
        });
    };

    res.on('finish', () => {
        const duration = Date.now() - start;
        queueLog({ method: req.method, status: res.statusCode, url: req.originalUrl, duration });
        notifyTelegram(req, res.statusCode, duration);
    });

    next();
});

// =========================
// STATIC FILES
// =========================
app.use('/', express.static(path.join(__dirname, 'api-page')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// =========================
// CUSTOM ROUTES
// =========================

// Route untuk halaman utama
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'api-page', 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.send('Welcome to Manzxy API Server');
    }
});

// Route untuk snippet page
app.get('/snippet', (req, res) => {
    const snippetPath = path.join(__dirname, 'api-page', 'snippet.html');
    if (fs.existsSync(snippetPath)) {
        res.sendFile(snippetPath);
    } else {
        res.status(404).send('Snippet page not found');
    }
});

// =========================
// ROUTE BARU: TikTok Downloader
// =========================
// Halaman TikTok Downloader
app.get('/tiktok', (req, res) => {
    const tiktokPath = path.join(__dirname, 'api-page', 'tiktok-downloader.html');
    
    if (fs.existsSync(tiktokPath)) {
        res.sendFile(tiktokPath);
    } else {
        // Jika file belum ada, buat response sederhana
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>TikTok Downloader</title>
                <meta http-equiv="refresh" content="3;url=/tiktok-downloader">
                <style>
                    body { font-family: Arial; text-align: center; padding: 50px; background: #0b0b0b; color: white; }
                </style>
            </head>
            <body>
                <h2>⏳ Redirecting...</h2>
                <p>Jika tidak otomatis redirect, <a href="/tiktok-downloader">klik disini</a></p>
            </body>
            </html>
        `);
    }
});

// Redirect alternatif
app.get('/tiktok-downloader', (req, res) => {
    res.redirect('/tiktok');
});

app.get('/download-tiktok', (req, res) => {
    res.redirect('/tiktok');
});

// =========================
// API PROXY untuk TikTok Downloader (opsional)
// =========================
// Endpoint proxy untuk menghindari CORS
app.get('/api/tiktok', async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) {
            return res.status(400).json({ error: 'URL parameter required' });
        }

        // Pilihan API yang tersedia
        const apiList = [
            `https://api.siputzx.my.id/api/d/tiktok?url=${encodeURIComponent(url)}`,
            `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`,
            `https://api.tikmate.io/api/convert?url=${encodeURIComponent(url)}`
        ];

        // Coba API satu per satu
        for (const apiUrl of apiList) {
            try {
                const response = await axios.get(apiUrl, { timeout: 8000 });
                if (response.data) {
                    return res.json({
                        success: true,
                        data: response.data,
                        from: apiUrl.split('/')[2]
                    });
                }
            } catch (e) {
                console.log(`API ${apiUrl} failed:`, e.message);
                continue;
            }
        }

        throw new Error('All APIs failed');
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// =========================
// MOCK OAUTH ENDPOINTS
// =========================
app.post('/auth/github', (req, res) => {
    const { code } = req.body;
    console.log(chalk.blue(`🔑 GitHub OAuth callback with code: ${code}`));
    
    const mockData = {
        id: 12345678,
        login: 'github_user_' + Date.now().toString().slice(-4),
        name: 'GitHub User',
        email: 'user@github.com',
        avatar_url: 'https://avatars.githubusercontent.com/u/583231?v=4',
        bio: 'GitHub user from OAuth login'
    };
    
    res.json(mockData);
});

app.post('/auth/google', (req, res) => {
    const { credential } = req.body;
    console.log(chalk.blue(`🔑 Google OAuth callback`));
    
    const mockData = {
        id: 'google_12345',
        name: 'Google User',
        email: 'user@gmail.com',
        picture: 'https://lh3.googleusercontent.com/a-/default-user',
        given_name: 'Google',
        family_name: 'User'
    };
    
    res.json(mockData);
});

// =========================
// LOAD API ROUTES
// =========================
let totalRoutes = 0;
const apiFolder = path.join(__dirname, './src/api');
if (fs.existsSync(apiFolder)) {
    fs.readdirSync(apiFolder).forEach(dir => {
        const dirPath = path.join(apiFolder, dir);
        if (fs.statSync(dirPath).isDirectory()) {
            fs.readdirSync(dirPath).forEach(file => {
                if (file.endsWith('.js')) {
                    try {
                        require(path.join(dirPath, file))(app);
                        totalRoutes++;
                        console.log(chalk.green(`  ✅ Loaded route: ${dir}/${file}`));
                    } catch (error) {
                        console.error(chalk.red(`❌ Failed to load route ${file}:`), error.message);
                    }
                }
            });
        }
    });
}

// =========================
// API DASHBOARD
// =========================
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        result: {
            status: "ONLINE",
            totalRequest: global.totalreq,
            totalRoutes,
            uptime: runtime(process.uptime()),
            domain: req.hostname
        }
    });
});

app.get('/api/info', (req, res) => {
    res.json({
        success: true,
        result: {
            name: settings.apiSettings?.creator || 'Manzxy',
            version: settings.version || "1.0.0",
            totalRoutes,
            serverTime: new Date().toISOString(),
            node: process.version,
            platform: process.platform
        }
    });
});

// =========================
// ERROR HANDLER
// =========================
app.use((req, res) => {
    const notFoundPath = path.join(__dirname, 'api-page', '404.html');
    if (fs.existsSync(notFoundPath)) {
        res.status(404).sendFile(notFoundPath);
    } else {
        res.status(404).json({ 
            error: 'Not Found',
            message: `Cannot ${req.method} ${req.path}`,
            availableRoutes: [
                '/',
                '/snippet',
                '/tiktok',
                '/api/status',
                '/api/info',
                '/api/tiktok?url=...'
            ]
        });
    }
});

app.use((err, req, res, next) => {
    queueLog({ method: req.method, status: 500, url: req.originalUrl, duration: 0, error: err.message });
    console.error(chalk.red('❌ Server error:'), err);
    
    const errorPath = path.join(__dirname, 'api-page', '500.html');
    if (fs.existsSync(errorPath)) {
        res.status(500).sendFile(errorPath);
    } else {
        res.status(500).json({ 
            error: 'Internal Server Error',
            message: err.message 
        });
    }
});

// =========================
// RUN SERVER
// =========================
app.listen(PORT, () => {
    console.log(chalk.green('\n🚀 ========================================'));
    console.log(chalk.green(`🚀  Manzxy API Server running on port ${PORT}`));
    console.log(chalk.green('🚀 ========================================\n'));
    
    console.log(chalk.cyan('📌 Available Routes:'));
    console.log(chalk.white(`   📄 Home:           http://localhost:${PORT}`));
    console.log(chalk.white(`   📝 Snippets:       http://localhost:${PORT}/snippet`));
    console.log(chalk.white(`   🎵 TikTok Downloader: http://localhost:${PORT}/tiktok`));
    console.log(chalk.white(`   📊 API Status:     http://localhost:${PORT}/api/status`));
    console.log(chalk.white(`   🔗 TikTok API:     http://localhost:${PORT}/api/tiktok?url=URL`));
    
    console.log(chalk.cyan('\n📁 Static Folders:'));
    console.log(chalk.white(`   📂 / (root)        → api-page/`));
    console.log(chalk.white(`   📂 /assets         → assets/`));
    
    console.log(chalk.yellow('\n🌐 Public URLs:'));
    console.log(chalk.white(`   🔗 https://manzxy.my.id`));
    console.log(chalk.white(`   🔗 https://manzxy.my.id/snippet`));
    console.log(chalk.white(`   🔗 https://manzxy.my.id/tiktok`));
    
    console.log(chalk.green('\n✅ Server ready! 🚀\n'));
});

module.exports = app;

// =========================
// UTIL
// =========================
function runtime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return `${h}h ${m}m ${s}s`;
}
