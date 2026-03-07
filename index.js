const express = require('express');
const chalk = require('chalk');
const fs = require('fs');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');

require("./function.js");

const app = express();
const PORT = process.env.PORT || 8080;

// =========================
// DISCORD WEBHOOK
// =========================
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || 'https://discord.com/api/webhooks/1396122030163628112/-vEj4HjREjbaOVXDu5932YjeHpTkjNSKyUKugBFF9yVCBeQSrdgK8qM3HNxVYTOD5BYP';

// =========================
// TELEGRAM NOTIFICATION
// =========================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8364129852:AAEjCrqQBI7f1OpVkhnxOBhcww9yegoJ-EU';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '7019305587';

// =========================
// LOG BUFFER
// =========================
let logBuffer = [];

// =========================
// SEND DISCORD LOG (BATCH) - only on persistent servers
// =========================
const IS_SERVERLESS = process.env.VERCEL || process.env.NOW_REGION || process.env.AWS_LAMBDA_FUNCTION_NAME;
if (!IS_SERVERLESS) {
  setInterval(() => {
    if (logBuffer.length === 0) return;
    const combinedLogs = logBuffer.join('\n');
    logBuffer = [];
    const payload = `\`\`\`ansi\n${combinedLogs}\n\`\`\``;
    axios.post(WEBHOOK_URL, { content: payload }).catch(() => {});
  }, 2000);
}

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
// SECURITY MIDDLEWARE
// =========================

// ── Helmet: HTTP security headers ─────────────────
app.use(helmet({
    contentSecurityPolicy: false, // disabled agar inline scripts di HTML tetap jalan
    crossOriginEmbedderPolicy: false,
    hsts: { maxAge: 31536000, includeSubDomains: true },
    frameguard: { action: 'deny' },
    xssFilter: true,
    noSniff: true,
    hidePoweredBy: true,
}));

// ── CORS ketat ─────────────────────────────────────
// Hapus wildcard CORS lama, ganti dengan konfigurasi explicit
// (cors() dipindah ke bawah, diganti dengan ini)

// ── Slow Down: mulai perlambat sebelum block ───────
const speedLimiter = slowDown({
    windowMs: 60 * 1000,        // 1 menit
    delayAfter: 30,             // mulai lambat setelah 30 req/menit
    delayMs: (used) => (used - 30) * 150, // +150ms per req berlebih
    maxDelayMs: 3000,           // max delay 3 detik
    skip: (req) => req.path.startsWith('/assets') || req.path.startsWith('/favicon'),
});
app.use(speedLimiter);

// ── Rate Limiter Global ────────────────────────────
const globalLimiter = rateLimit({
    windowMs: 60 * 1000,        // 1 menit window
    max: 60,                    // 60 req per IP per menit
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => req.path.startsWith('/assets') || req.path === '/favicon.ico',
    handler: (req, res) => {
        queueLog({ method: req.method, status: 429, url: req.originalUrl, duration: 0 });
        return res.status(429).json({
            success: false,
            error: 'Terlalu banyak request. Coba lagi dalam 1 menit.',
            retryAfter: Math.ceil(req.rateLimit.resetTime / 1000),
        });
    },
});
app.use(globalLimiter);

// ── Rate Limiter ketat untuk API endpoints ─────────
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,                    // API hanya 20 req/menit per IP
    skip: (req) => !req.path.startsWith('/api'),
    handler: (req, res) => {
        return res.status(429).json({
            success: false,
            error: 'API rate limit. Maksimal 20 request/menit per IP.',
        });
    },
});
app.use(apiLimiter);

// ── Rate Limiter sangat ketat untuk TikTok ─────────
const tiktokLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 8,                     // max 8 download/menit per IP (scraping mahal)
    skip: (req) => req.path !== '/api/tiktok',
    handler: (req, res) => {
        return res.status(429).json({
            success: false,
            error: 'TikTok limit. Maksimal 8 request/menit.',
        });
    },
});
app.use(tiktokLimiter);

// ── Payload size limit ─────────────────────────────
// (didefinisikan di express.json() di bawah)

// ── Block suspicious User-Agents ──────────────────
const BLOCKED_UA = [
    /sqlmap/i, /nikto/i, /nessus/i, /masscan/i,
    /zgrab/i, /python-requests\/2\.(?:[0-9]\.|[12][0-9]\.)/i,
    /go-http-client\/1\./i, /curl\/7\.[0-5]/i,
];
app.use((req, res, next) => {
    const ua = req.headers['user-agent'] || '';
    if (BLOCKED_UA.some(rx => rx.test(ua))) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    next();
});

// ── Request size & timeout guard ──────────────────
app.use((req, res, next) => {
    // Timeout per request 30 detik
    req.setTimeout(30000, () => {
        if (!res.headersSent) res.status(408).json({ error: 'Request timeout' });
    });
    next();
});

app.enable("trust proxy");
app.set("json spaces", 2);
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));
app.use(cors({
    origin: function(origin, callback) {
        // Allow: no origin (curl, mobile apps), same domain, localhost dev
        const allowed = [
            /manzxy\.my\.id$/,
            /localhost/,
            /127\.0\.0\.1/,
            /vercel\.app$/,
        ];
        if (!origin || allowed.some(rx => rx.test(origin))) {
            callback(null, true);
        } else {
            callback(null, true); // masih allow tapi bisa diubah jadi false untuk strict
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
}));

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
// CUSTOM ROUTES - Page Routes (must be BEFORE static middleware)
// =========================

// Route untuk halaman utama
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'api-page', 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head><title>Manzxy API</title></head>
            <body style="font-family: Arial; text-align: center; padding: 50px;">
                <h1>🚀 Manzxy API Server</h1>
                <p>Server berjalan dengan baik!</p>
                <p>📌 <a href="/snippet">Snippets</a></p>
                <p>🎵 <a href="/tiktok">TikTok Downloader</a></p>
            </body>
            </html>
        `);
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

// Route tiktok page
app.get('/tiktok', (req, res) => {
    const p = require('path').join(__dirname, 'api-page', 'tiktok.html');
    if (require('fs').existsSync(p)) res.sendFile(p);
    else res.status(404).send('TikTok page not found');
});


// =========================
// SNIPPET API ROUTES (must be BEFORE static middleware)
// =========================
require('./src/api/snippet/routes.js')(app);
console.log(chalk.green('  ✅ Loaded route: snippet/routes.js'));

// =========================
// STATIC FILES (after explicit routes)
// =========================
app.use('/', express.static(path.join(__dirname, 'api-page')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// =========================
// TIKTOK SCRAPER (SaveTT.cc)
// =========================

// Headers untuk scraping
const SAVETT_HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Origin': 'https://savett.cc',
  'Referer': 'https://savett.cc/en1/download',
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36'
};

/**
 * Mendapatkan CSRF token dan cookie dari SaveTT.cc
 */
async function getSavettToken() {
  try {
    const response = await axios.get('https://savett.cc/en1/download');
    
    // Ambil CSRF token dari HTML
    const csrfMatch = response.data.match(/name="csrf_token" value="([^"]+)"/);
    const csrf = csrfMatch ? csrfMatch[1] : null;
    
    // Ambil cookie dari response headers
    const cookies = response.headers['set-cookie'];
    const cookie = cookies ? cookies.map(c => c.split(';')[0]).join('; ') : '';
    
    if (!csrf) {
      throw new Error('CSRF token tidak ditemukan');
    }
    
    return { csrf, cookie };
  } catch (error) {
    throw new Error(`Gagal mendapatkan token: ${error.message}`);
  }
}

/**
 * Mengirim request download ke SaveTT.cc
 */
async function downloadFromSavett(url, csrf, cookie) {
  try {
    const formData = `csrf_token=${encodeURIComponent(csrf)}&url=${encodeURIComponent(url)}`;
    
    const response = await axios.post('https://savett.cc/en1/download', formData, {
      headers: {
        ...SAVETT_HEADERS,
        Cookie: cookie
      }
    });
    
    return response.data;
  } catch (error) {
    throw new Error(`Gagal download: ${error.message}`);
  }
}

/**
 * Parse HTML dari SaveTT.cc menjadi data terstruktur
 */
function parseSavettHTML(html) {
  const $ = cheerio.load(html);
  
  // Ambil username
  const username = $('#video-info h3').first().text().trim() || 'Unknown';
  
  // Ambil statistik
  const stats = [];
  $('#video-info .my-1 span').each((_, el) => {
    stats.push($(el).text().trim());
  });
  
  // Ambil durasi
  const durationText = $('#video-info p.text-muted').first().text();
  const duration = durationText.replace(/Duration:/i, '').trim() || null;
  
  // Data awal
  const result = {
    username,
    views: stats[0] || null,
    likes: stats[1] || null,
    bookmarks: stats[2] || null,
    comments: stats[3] || null,
    shares: stats[4] || null,
    duration,
    type: null, // 'video' atau 'photo'
    videos: {
      nowm: [], // tanpa watermark
      wm: []   // dengan watermark
    },
    audio: [], // MP3
    images: [] // untuk slide
  };
  
  // Cek apakah ini slide (multiple images)
  const slides = $('.carousel-item[data-data]');
  
  if (slides.length > 0) {
    // Ini adalah konten foto (slide)
    result.type = 'photo';
    
    slides.each((_, el) => {
      try {
        // Parse data-data attribute yang berisi JSON
        const dataAttr = $(el).attr('data-data').replace(/&quot;/g, '"');
        const jsonData = JSON.parse(dataAttr);
        
        if (jsonData.URL) {
          if (Array.isArray(jsonData.URL)) {
            jsonData.URL.forEach(url => {
              result.images.push(url);
            });
          } else {
            result.images.push(jsonData.URL);
          }
        }
      } catch (e) {
        console.log('Gagal parse slide:', e.message);
      }
    });
    
    return result;
  }
  
  // Ini adalah video
  result.type = 'video';
  
  // Parse semua opsi download
  $('#formatselect option').each((_, el) => {
    const label = $(el).text().toLowerCase();
    const value = $(el).attr('value');
    
    if (!value) return;
    
    try {
      // Value berisi JSON string
      const jsonData = JSON.parse(value.replace(/&quot;/g, '"'));
      
      if (!jsonData.URL) return;
      
      const urls = Array.isArray(jsonData.URL) ? jsonData.URL : [jsonData.URL];
      
      // Kategorikan berdasarkan label
      if (label.includes('mp4')) {
        if (label.includes('watermark')) {
          // Video dengan watermark
          result.videos.wm.push(...urls);
        } else {
          // Video tanpa watermark
          result.videos.nowm.push(...urls);
        }
      }
      
      if (label.includes('mp3')) {
        // Audio MP3
        result.audio.push(...urls);
      }
      
    } catch (e) {
      console.log('Gagal parse option:', e.message);
    }
  });
  
  return result;
}

// =========================
// API ENDPOINT TIKTOK
// =========================

/**
 * Endpoint utama untuk download TikTok
 * URL: /api/tiktok?url=https://vt.tiktok.com/xxx
 */
app.get('/api/tiktok', async (req, res) => {
  try {
    const { url } = req.query;
    
    // Validasi input
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'Parameter URL diperlukan'
      });
    }
    
    if (!url.includes('tiktok.com')) {
      return res.status(400).json({
        success: false,
        error: 'URL tidak valid. Harus dari tiktok.com'
      });
    }
    
    console.log(chalk.yellow(`🎯 Processing TikTok URL: ${url}`));
    
    // Langkah 1: Dapatkan token dan cookie
    const { csrf, cookie } = await getSavettToken();
    console.log(chalk.green('✅ CSRF token didapatkan'));
    
    // Langkah 2: Kirim request download
    const html = await downloadFromSavett(url, csrf, cookie);
    console.log(chalk.green('✅ Response dari SaveTT diterima'));
    
    // Langkah 3: Parse HTML
    const data = parseSavettHTML(html);
    console.log(chalk.green('✅ Data berhasil diparse'));
    
    // Kirim response
    res.json({
      success: true,
      data,
      from: 'savett.cc'
    });
    
  } catch (error) {
    console.error(chalk.red('❌ Error:'), error.message);
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// tiktok routes handled above

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
            error: 'Internal Server Error'
        });
    }
});

// =========================
// RUN SERVER
// =========================
if (!IS_SERVERLESS) app.listen(PORT, () => {
    console.log(chalk.green('\n🚀 ========================================'));
    console.log(chalk.green(`🚀  Manzxy API Server running on port ${PORT}`));
    console.log(chalk.green('🚀 ========================================\n'));
    
    console.log(chalk.cyan('📌 Available Routes:'));
    console.log(chalk.white(`   📄 Home:           http://localhost:${PORT}`));
    console.log(chalk.white(`   📝 Snippets:       http://localhost:${PORT}/snippet`));
    console.log(chalk.white(`   🎵 TikTok:         http://localhost:${PORT}/tiktok`));
    console.log(chalk.white(`   📊 API Status:     http://localhost:${PORT}/api/status`));
    
    console.log(chalk.cyan('\n🔧 TikTok Endpoints:'));
    console.log(chalk.white(`   🔍 Scrape (SaveTT): http://localhost:${PORT}/api/tiktok?url=URL`));
    
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
