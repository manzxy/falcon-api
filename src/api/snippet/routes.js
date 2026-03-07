const fs = require("fs")
const path = require("path")
const crypto = require("crypto")

// ─── PATH ke file JSON penyimpanan snippet ───────────────────────────────────
const DB_PATH = path.join(__dirname, "../../../assets/snippets.json")

// ─── Helper: baca DB ─────────────────────────────────────────────────────────
function readDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ snippets: [] }, null, 2))
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"))
  } catch {
    return { snippets: [] }
  }
}

// ─── Helper: tulis DB ────────────────────────────────────────────────────────
function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2))
}

// ─── Helper: generate ID unik ────────────────────────────────────────────────
function genId() {
  return crypto.randomBytes(6).toString("hex")
}

// ─── Helper: sanitize string ─────────────────────────────────────────────────
function sanitize(str, maxLen = 500) {
  if (typeof str !== "string") return ""
  return str.trim().slice(0, maxLen)
}

// ─── Validasi bahasa yang diizinkan ──────────────────────────────────────────
const ALLOWED_LANGS = [
  "javascript", "python", "php", "html", "css", "java", "cpp",
  "csharp", "ruby", "go", "rust", "swift", "kotlin", "typescript",
  "sql", "bash", "text"
]

// ─────────────────────────────────────────────────────────────────────────────

module.exports = function (app) {

  // ── GET /api/snippets ─────────────────────────────────────────────────────
  // Ambil semua snippet (publik). Support query: ?lang=js&page=1&limit=20
  app.get("/api/snippets", (req, res) => {
    try {
      const { lang, page = 1, limit = 20 } = req.query
      const db = readDB()

      let snippets = [...db.snippets].sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      )

      // Filter by language
      if (lang && lang !== "all") {
        snippets = snippets.filter((s) => s.language === lang)
      }

      // Pagination
      const total = snippets.length
      const start = (Number(page) - 1) * Number(limit)
      const paginated = snippets.slice(start, start + Number(limit))

      return res.json({
        success: true,
        total,
        page: Number(page),
        limit: Number(limit),
        snippets: paginated
      })
    } catch (e) {
      return res.status(500).json({ success: false, message: e.message })
    }
  })

  // ── GET /api/snippets/:id ─────────────────────────────────────────────────
  // Ambil satu snippet by ID
  app.get("/api/snippets/:id", (req, res) => {
    try {
      const db = readDB()
      const snippet = db.snippets.find((s) => s.id === req.params.id)

      if (!snippet) {
        return res.status(404).json({ success: false, message: "Snippet tidak ditemukan" })
      }

      return res.json({ success: true, snippet })
    } catch (e) {
      return res.status(500).json({ success: false, message: e.message })
    }
  })

  // ── POST /api/snippets ────────────────────────────────────────────────────
  // Tambah snippet baru
  app.post("/api/snippets", (req, res) => {
    try {
      const {
        title, language, description, code,
        authorId, authorName, authorAvatar
      } = req.body

      // Validasi wajib
      if (!title || !language || !code || !authorId || !authorName) {
        return res.status(400).json({
          success: false,
          message: "Field wajib: title, language, code, authorId, authorName"
        })
      }

      if (!ALLOWED_LANGS.includes(language)) {
        return res.status(400).json({
          success: false,
          message: "Bahasa tidak didukung"
        })
      }

      const db = readDB()

      const snippet = {
        id: genId(),
        title: sanitize(title, 100),
        language,
        description: sanitize(description || "", 300),
        code: sanitize(code, 10000),
        authorId: sanitize(authorId, 100),
        authorName: sanitize(authorName, 60),
        authorAvatar: sanitize(authorAvatar || "", 300),
        likes: 0,
        likedBy: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }

      db.snippets.push(snippet)
      writeDB(db)

      return res.status(201).json({ success: true, snippet })
    } catch (e) {
      return res.status(500).json({ success: false, message: e.message })
    }
  })

  // ── PUT /api/snippets/:id ─────────────────────────────────────────────────
  // Edit snippet (hanya pemilik)
  app.put("/api/snippets/:id", (req, res) => {
    try {
      const { title, language, description, code, authorId } = req.body

      if (!authorId) {
        return res.status(400).json({ success: false, message: "authorId wajib" })
      }

      const db = readDB()
      const idx = db.snippets.findIndex((s) => s.id === req.params.id)

      if (idx === -1) {
        return res.status(404).json({ success: false, message: "Snippet tidak ditemukan" })
      }

      if (db.snippets[idx].authorId !== authorId) {
        return res.status(403).json({ success: false, message: "Bukan milik kamu" })
      }

      // Update hanya field yang dikirim
      if (title) db.snippets[idx].title = sanitize(title, 100)
      if (language && ALLOWED_LANGS.includes(language)) db.snippets[idx].language = language
      if (description !== undefined) db.snippets[idx].description = sanitize(description, 300)
      if (code) db.snippets[idx].code = sanitize(code, 10000)
      db.snippets[idx].updatedAt = new Date().toISOString()

      writeDB(db)

      return res.json({ success: true, snippet: db.snippets[idx] })
    } catch (e) {
      return res.status(500).json({ success: false, message: e.message })
    }
  })

  // ── DELETE /api/snippets/:id ──────────────────────────────────────────────
  // Hapus snippet (hanya pemilik)
  app.delete("/api/snippets/:id", (req, res) => {
    try {
      const { authorId } = req.body

      if (!authorId) {
        return res.status(400).json({ success: false, message: "authorId wajib" })
      }

      const db = readDB()
      const idx = db.snippets.findIndex((s) => s.id === req.params.id)

      if (idx === -1) {
        return res.status(404).json({ success: false, message: "Snippet tidak ditemukan" })
      }

      if (db.snippets[idx].authorId !== authorId) {
        return res.status(403).json({ success: false, message: "Bukan milik kamu" })
      }

      db.snippets.splice(idx, 1)
      writeDB(db)

      return res.json({ success: true, message: "Snippet dihapus" })
    } catch (e) {
      return res.status(500).json({ success: false, message: e.message })
    }
  })

  // ── POST /api/snippets/:id/like ───────────────────────────────────────────
  // Toggle like/unlike
  app.post("/api/snippets/:id/like", (req, res) => {
    try {
      const { userId } = req.body

      if (!userId) {
        return res.status(400).json({ success: false, message: "userId wajib" })
      }

      const db = readDB()
      const snippet = db.snippets.find((s) => s.id === req.params.id)

      if (!snippet) {
        return res.status(404).json({ success: false, message: "Snippet tidak ditemukan" })
      }

      const likedBy = snippet.likedBy || []
      const already = likedBy.indexOf(userId)

      let action
      if (already === -1) {
        likedBy.push(userId)
        snippet.likes = (snippet.likes || 0) + 1
        action = "liked"
      } else {
        likedBy.splice(already, 1)
        snippet.likes = Math.max(0, (snippet.likes || 0) - 1)
        action = "unliked"
      }

      snippet.likedBy = likedBy
      writeDB(db)

      return res.json({ success: true, action, likes: snippet.likes })
    } catch (e) {
      return res.status(500).json({ success: false, message: e.message })
    }
  })

}

  // ── POST /api/snippets/:id/view ──────────────────────────────────────────
  // Increment view counter (fire & forget dari client)
  app.post("/api/snippets/:id/view", (req, res) => {
    try {
      const db = readDB()
      const snippet = db.snippets.find((s) => s.id === req.params.id)
      if (!snippet) return res.status(404).json({ success: false })
      snippet.views = (snippet.views || 0) + 1
      writeDB(db)
      return res.json({ success: true, views: snippet.views })
    } catch (e) {
      return res.status(500).json({ success: false, message: e.message })
    }
  })

}
