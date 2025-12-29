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
const settings = JSON.parse(fs.readFileSync(settingsPath));
global.apikey = settings.apiSettings.apikey;
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
            creator: settings.apiSettings.creator,
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
// STATIC
// =========================
app.use('/', express.static(path.join(__dirname, 'api-page')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// =========================
// LOAD ROUTES
// =========================
let totalRoutes = 0;
const apiFolder = path.join(__dirname, './src/api');
fs.readdirSync(apiFolder).forEach(dir => {
    const dirPath = path.join(apiFolder, dir);
    if (fs.statSync(dirPath).isDirectory()) {
        fs.readdirSync(dirPath).forEach(file => {
            if (file.endsWith('.js')) {
                require(path.join(dirPath, file))(app);
                totalRoutes++;
            }
        });
    }
});

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
            name: settings.apiSettings.creator,
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
app.use((req, res) => res.status(404).sendFile(process.cwd() + "/api-page/404.html"));
app.use((err, req, res, next) => {
    queueLog({ method: req.method, status: 500, url: req.originalUrl, duration: 0, error: err.message });
    res.status(500).sendFile(process.cwd() + "/api-page/500.html");
});

// =========================
// RUN SERVER
// =========================
app.listen(PORT, () => {
    console.log(chalk.green(`🚀 Server running on port ${PORT}`));
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
