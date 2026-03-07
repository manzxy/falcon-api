const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const { createClient } = require("@supabase/supabase-js")

// ─── Supabase client ──────────────────────────────────────────────────────────
const SUPABASE_URL  = process.env.SUPABASE_URL  || ""
const SUPABASE_KEY  = process.env.SUPABASE_ANON_KEY || ""
const USE_SUPABASE  = !!(SUPABASE_URL && SUPABASE_KEY)

let supabase = null
if (USE_SUPABASE) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
}

// ─── Fallback: JSON file / in-memory ─────────────────────────────────────────
const DB_PATH = path.join(__dirname, "../../../assets/snippets.json")
const IS_SERVERLESS = !!(process.env.VERCEL || process.env.NOW_REGION)
let memStore = null

function readLocal() {
  if (IS_SERVERLESS) {
    if (!memStore) memStore = { snippets: [] }
    return memStore
  }
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify({ snippets: [] }, null, 2))
  try { return JSON.parse(fs.readFileSync(DB_PATH, "utf-8")) }
  catch { return { snippets: [] } }
}
function writeLocal(data) {
  if (IS_SERVERLESS) { memStore = data; return }
  try { fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2)) }
  catch { memStore = data }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function genId() { return crypto.randomBytes(8).toString("hex") }
function sanitize(s, max = 500) { return typeof s === "string" ? s.trim().slice(0, max) : "" }

const ALLOWED_LANGS = [
  "javascript","typescript","python","php","html","css",
  "java","cpp","csharp","go","rust","bash","sql","text"
]

// ─────────────────────────────────────────────────────────────────────────────
module.exports = function (app) {

  // ══════════════════════════════════════════════════════
  // GET /api/snippets  — list all
  // ══════════════════════════════════════════════════════
  app.get("/api/snippets", async (req, res) => {
    try {
      const { lang, page = 1, limit = 50 } = req.query

      if (USE_SUPABASE) {
        let q = supabase
          .from("snippets")
          .select("*")
          .order("created_at", { ascending: false })
          .range((page - 1) * limit, page * limit - 1)

        if (lang && lang !== "all") q = q.eq("language", lang)

        const { data, error, count } = await q
        if (error) throw new Error(error.message)

        return res.json({ success: true, total: count || data.length, snippets: (data || []).map(normalizeOut) })
      }

      // fallback
      const db = readLocal()
      let snippets = [...(db.snippets || [])]
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      if (lang && lang !== "all") snippets = snippets.filter(s => s.language === lang)
      const total = snippets.length
      const start = (Number(page) - 1) * Number(limit)
      return res.json({ success: true, total, snippets: snippets.slice(start, start + Number(limit)) })

    } catch (e) { return res.status(500).json({ success: false, message: e.message }) }
  })

  // ══════════════════════════════════════════════════════
  // GET /api/snippets/:id  — single
  // ══════════════════════════════════════════════════════
  app.get("/api/snippets/:id", async (req, res) => {
    try {
      if (USE_SUPABASE) {
        const { data, error } = await supabase
          .from("snippets").select("*").eq("id", req.params.id).single()
        if (error) return res.status(404).json({ success: false, message: "Snippet tidak ditemukan" })
        return res.json({ success: true, snippet: data })
      }

      const db = readLocal()
      const snippet = db.snippets.find(s => s.id === req.params.id)
      if (!snippet) return res.status(404).json({ success: false, message: "Snippet tidak ditemukan" })
      return res.json({ success: true, snippet })

    } catch (e) { return res.status(500).json({ success: false, message: e.message }) }
  })

  // ══════════════════════════════════════════════════════
  // POST /api/snippets  — create
  // ══════════════════════════════════════════════════════
  app.post("/api/snippets", async (req, res) => {
    try {
      const { title, language, description, code, authorId, authorName, authorAvatar } = req.body

      if (!title || !language || !code || !authorId || !authorName)
        return res.status(400).json({ success: false, message: "Field wajib: title, language, code, authorId, authorName" })
      if (!ALLOWED_LANGS.includes(language))
        return res.status(400).json({ success: false, message: "Bahasa tidak didukung" })

      const snippet = {
        id: genId(),
        title: sanitize(title, 100),
        language,
        description: sanitize(description || "", 300),
        code: sanitize(code, 10000),
        author_id: sanitize(authorId, 100),
        author_name: sanitize(authorName, 60),
        author_avatar: sanitize(authorAvatar || "", 300),
        likes: 0,
        liked_by: [],
        views: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      if (USE_SUPABASE) {
        const { data, error } = await supabase.from("snippets").insert([snippet]).select().single()
        if (error) throw new Error(error.message)
        return res.status(201).json({ success: true, snippet: normalizeOut(data) })
      }

      // fallback — keep camelCase for local
      const localSnippet = toCamel(snippet)
      const db = readLocal()
      db.snippets.push(localSnippet)
      writeLocal(db)
      return res.status(201).json({ success: true, snippet: localSnippet })

    } catch (e) { return res.status(500).json({ success: false, message: e.message }) }
  })

  // ══════════════════════════════════════════════════════
  // PUT /api/snippets/:id  — update (owner only)
  // ══════════════════════════════════════════════════════
  app.put("/api/snippets/:id", async (req, res) => {
    try {
      const { title, language, description, code, authorId } = req.body
      if (!authorId) return res.status(400).json({ success: false, message: "authorId wajib" })

      if (USE_SUPABASE) {
        // verify ownership
        const { data: existing, error: fetchErr } = await supabase
          .from("snippets").select("author_id").eq("id", req.params.id).single()
        if (fetchErr) return res.status(404).json({ success: false, message: "Snippet tidak ditemukan" })
        if (existing.author_id !== authorId) return res.status(403).json({ success: false, message: "Bukan milik kamu" })

        const updates = { updated_at: new Date().toISOString() }
        if (title) updates.title = sanitize(title, 100)
        if (language && ALLOWED_LANGS.includes(language)) updates.language = language
        if (description !== undefined) updates.description = sanitize(description, 300)
        if (code) updates.code = sanitize(code, 10000)

        const { data, error } = await supabase
          .from("snippets").update(updates).eq("id", req.params.id).select().single()
        if (error) throw new Error(error.message)
        return res.json({ success: true, snippet: normalizeOut(data) })
      }

      // fallback
      const db = readLocal()
      const idx = db.snippets.findIndex(s => s.id === req.params.id)
      if (idx === -1) return res.status(404).json({ success: false, message: "Snippet tidak ditemukan" })
      if (db.snippets[idx].authorId !== authorId) return res.status(403).json({ success: false, message: "Bukan milik kamu" })
      if (title) db.snippets[idx].title = sanitize(title, 100)
      if (language && ALLOWED_LANGS.includes(language)) db.snippets[idx].language = language
      if (description !== undefined) db.snippets[idx].description = sanitize(description, 300)
      if (code) db.snippets[idx].code = sanitize(code, 10000)
      db.snippets[idx].updatedAt = new Date().toISOString()
      writeLocal(db)
      return res.json({ success: true, snippet: db.snippets[idx] })

    } catch (e) { return res.status(500).json({ success: false, message: e.message }) }
  })

  // ══════════════════════════════════════════════════════
  // DELETE /api/snippets/:id  — delete (owner only)
  // ══════════════════════════════════════════════════════
  app.delete("/api/snippets/:id", async (req, res) => {
    try {
      const { authorId } = req.body
      if (!authorId) return res.status(400).json({ success: false, message: "authorId wajib" })

      if (USE_SUPABASE) {
        const { data: existing, error: fetchErr } = await supabase
          .from("snippets").select("author_id").eq("id", req.params.id).single()
        if (fetchErr) return res.status(404).json({ success: false, message: "Snippet tidak ditemukan" })
        if (existing.author_id !== authorId) return res.status(403).json({ success: false, message: "Bukan milik kamu" })
        const { error } = await supabase.from("snippets").delete().eq("id", req.params.id)
        if (error) throw new Error(error.message)
        return res.json({ success: true, message: "Snippet dihapus" })
      }

      // fallback
      const db = readLocal()
      const idx = db.snippets.findIndex(s => s.id === req.params.id)
      if (idx === -1) return res.status(404).json({ success: false, message: "Snippet tidak ditemukan" })
      if (db.snippets[idx].authorId !== authorId) return res.status(403).json({ success: false, message: "Bukan milik kamu" })
      db.snippets.splice(idx, 1)
      writeLocal(db)
      return res.json({ success: true, message: "Snippet dihapus" })

    } catch (e) { return res.status(500).json({ success: false, message: e.message }) }
  })

  // ══════════════════════════════════════════════════════
  // POST /api/snippets/:id/like  — toggle like
  // ══════════════════════════════════════════════════════
  app.post("/api/snippets/:id/like", async (req, res) => {
    try {
      const { userId } = req.body
      if (!userId) return res.status(400).json({ success: false, message: "userId wajib" })

      if (USE_SUPABASE) {
        const { data: s, error: fetchErr } = await supabase
          .from("snippets").select("likes, liked_by").eq("id", req.params.id).single()
        if (fetchErr) return res.status(404).json({ success: false, message: "Snippet tidak ditemukan" })

        const likedBy = s.liked_by || []
        const already = likedBy.includes(userId)
        const newLikedBy = already ? likedBy.filter(id => id !== userId) : [...likedBy, userId]
        const newLikes = Math.max(0, (s.likes || 0) + (already ? -1 : 1))
        const action = already ? "unliked" : "liked"

        const { error } = await supabase
          .from("snippets").update({ likes: newLikes, liked_by: newLikedBy }).eq("id", req.params.id)
        if (error) throw new Error(error.message)
        return res.json({ success: true, action, likes: newLikes })
      }

      // fallback
      const db = readLocal()
      const snippet = db.snippets.find(s => s.id === req.params.id)
      if (!snippet) return res.status(404).json({ success: false, message: "Snippet tidak ditemukan" })
      const likedBy = snippet.likedBy || []
      const already = likedBy.includes(userId)
      if (already) { likedBy.splice(likedBy.indexOf(userId), 1); snippet.likes = Math.max(0, (snippet.likes || 0) - 1) }
      else { likedBy.push(userId); snippet.likes = (snippet.likes || 0) + 1 }
      snippet.likedBy = likedBy
      writeLocal(db)
      return res.json({ success: true, action: already ? "unliked" : "liked", likes: snippet.likes })

    } catch (e) { return res.status(500).json({ success: false, message: e.message }) }
  })

  // ══════════════════════════════════════════════════════
  // POST /api/snippets/:id/view  — increment views
  // ══════════════════════════════════════════════════════
  app.post("/api/snippets/:id/view", async (req, res) => {
    try {
      if (USE_SUPABASE) {
        // increment via rpc or manual
        const { data: s } = await supabase.from("snippets").select("views").eq("id", req.params.id).single()
        const newViews = (s?.views || 0) + 1
        await supabase.from("snippets").update({ views: newViews }).eq("id", req.params.id)
        return res.json({ success: true, views: newViews })
      }

      const db = readLocal()
      const snippet = db.snippets.find(s => s.id === req.params.id)
      if (!snippet) return res.status(404).json({ success: false })
      snippet.views = (snippet.views || 0) + 1
      writeLocal(db)
      return res.json({ success: true, views: snippet.views })

    } catch (e) { return res.status(500).json({ success: false, message: e.message }) }
  })
}

// ─── Normalize Supabase snake_case → camelCase untuk frontend ────────────────
function normalizeOut(s) {
  if (!s) return s
  return {
    id: s.id,
    title: s.title,
    language: s.language,
    description: s.description,
    code: s.code,
    authorId: s.author_id,
    authorName: s.author_name,
    authorAvatar: s.author_avatar,
    likes: s.likes,
    likedBy: s.liked_by || [],
    views: s.views,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  }
}

function toCamel(s) {
  return {
    id: s.id,
    title: s.title,
    language: s.language,
    description: s.description,
    code: s.code,
    authorId: s.author_id,
    authorName: s.author_name,
    authorAvatar: s.author_avatar,
    likes: s.likes,
    likedBy: s.liked_by || [],
    views: s.views,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  }
}
