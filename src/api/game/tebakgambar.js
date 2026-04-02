const axios = require('axios');

const JSON_URL = 'https://raw.githubusercontent.com/manzxy/dbgame/main/tebakgambar.json';
const SOAL_PER_LEVEL = 20;

// Simple in-memory cache (reset on restart)
let cache = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 menit

async function fetchTebakGambar() {
    const now = Date.now();
    if (cache && (now - cacheTime) < CACHE_TTL) return cache;

    const response = await axios.get(JSON_URL, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Android 10; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
            'Accept': 'application/json',
        },
        timeout: 8000,
    });

    cache = response.data;
    cacheTime = now;
    return cache;
}

module.exports = function (app) {

    /**
     * GET /game/tebakgambar
     *
     * Query params:
     *   level   - nomor level (1-based, 20 soal per level)
     *   index   - nomor soal spesifik (0-based)
     *   random  - "true" => ambil 1 soal acak (bisa dikombinasikan dgn level)
     *   search  - cari jawaban (case-insensitive)
     *   page    - halaman (default 1), dikombinasikan dgn limit
     *   limit   - jumlah soal per halaman (default 20, max 50)
     */
    /**
     * GET /game/tebakgambar
     *
     * Default  → 1 soal random
     * ?level=1 → 1 soal random dari level tersebut
     * ?index=5 → soal spesifik by index (0-based)
     * ?search= → cari di jawaban/deskripsi, return 1 soal random dari hasil
     * ?all=true          → semua soal (array)
     * ?all=true&level=1  → semua soal level tertentu (array)
     * ?page=&limit=      → pagination array (aktif hanya kalau ada ?all=true)
     */
    app.get('/game/tebakgambar', async (req, res) => {
        try {
            const { level, index, search, all, page, limit } = req.query;
            const data = await fetchTebakGambar();

            // ── index spesifik ──────────────────────────────────────
            if (index !== undefined) {
                const idx = parseInt(index);
                if (isNaN(idx) || idx < 0 || idx >= data.length) {
                    return res.status(400).json({
                        status: false,
                        creator: 'Manzxy',
                        message: `Index tidak valid. Range: 0 - ${data.length - 1}`,
                    });
                }
                return res.json({
                    status: true,
                    creator: 'Manzxy',
                    result: data[idx],
                });
            }

            // ── filter pool by level ────────────────────────────────
            let pool = data;
            if (level !== undefined) {
                const lvl = parseInt(level);
                if (isNaN(lvl) || lvl < 1) {
                    return res.status(400).json({
                        status: false,
                        creator: 'Manzxy',
                        message: 'Level harus berupa angka >= 1',
                    });
                }
                pool = data.slice((lvl - 1) * SOAL_PER_LEVEL, lvl * SOAL_PER_LEVEL);
                if (!pool.length) {
                    return res.status(404).json({
                        status: false,
                        creator: 'Manzxy',
                        message: `Level ${lvl} tidak ditemukan. Level max: ${Math.ceil(data.length / SOAL_PER_LEVEL)}`,
                    });
                }
            }

            // ── filter by search ────────────────────────────────────
            if (search) {
                const q = search.toLowerCase().trim();
                pool = pool.filter(s =>
                    s.jawaban?.toLowerCase().includes(q) ||
                    s.deskripsi?.toLowerCase().includes(q)
                );
                if (!pool.length) {
                    return res.status(404).json({
                        status: false,
                        creator: 'Manzxy',
                        message: 'Soal tidak ditemukan.',
                    });
                }
            }

            // ── ?all=true → return array dengan pagination ──────────
            if (all === 'true') {
                const pageNum  = Math.max(1, parseInt(page) || 1);
                const pageSize = Math.min(50, Math.max(1, parseInt(limit) || SOAL_PER_LEVEL));
                const total    = pool.length;
                const sliced   = pool.slice((pageNum - 1) * pageSize, pageNum * pageSize);

                return res.json({
                    status: true,
                    creator: 'Manzxy',
                    total,
                    page: pageNum,
                    total_pages: Math.ceil(total / pageSize),
                    per_page: pageSize,
                    ...(level ? { level: parseInt(level) } : {}),
                    result: sliced,
                });
            }

            // ── default: 1 soal random ──────────────────────────────
            const picked = pool[Math.floor(Math.random() * pool.length)];
            return res.json({
                status: true,
                creator: 'Manzxy',
                result: picked,
            });

        } catch (error) {
            return res.status(500).json({
                status: false,
                creator: 'Manzxy',
                message: `Error: ${error.message}`,
            });
        }
    });

    /**
     * GET /game/tebakgambar/info
     * Info total soal & jumlah level
     */
    app.get('/game/tebakgambar/info', async (req, res) => {
        try {
            const all = await fetchTebakGambar();
            return res.json({
                status: true,
                total_soal: all.length,
                soal_per_level: SOAL_PER_LEVEL,
                total_level: Math.ceil(all.length / SOAL_PER_LEVEL),
            });
        } catch (error) {
            return res.status(500).json({ status: false, message: `Error: ${error.message}` });
        }
    });
};
                                  
