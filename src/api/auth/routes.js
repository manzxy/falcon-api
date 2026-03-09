const { createClient } = require("@supabase/supabase-js")
const axios            = require("axios")
const crypto           = require("crypto")
const bcrypt           = require("bcryptjs")
const jwt              = require("jsonwebtoken")

// ─── Supabase ─────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || ""
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || ""
const isValidUrl   = /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(SUPABASE_URL)
const isValidKey   = SUPABASE_KEY.startsWith("eyJ") && SUPABASE_KEY.length > 100
const USE_SUPABASE = isValidUrl && isValidKey

let supabase = null
if (USE_SUPABASE) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
  console.log("✅ Auth: Supabase connected")
} else {
  console.warn("⚠️  Auth: Supabase tidak tersedia, pakai in-memory fallback")
}

// ─── Config ───────────────────────────────────────────────────────────────────
const GH_CLIENT_ID     = process.env.GITHUB_CLIENT_ID     || "Ov23ctRnIkJzTTgFJUZn"
const GH_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || ""
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID     || ""
const JWT_SECRET       = process.env.JWT_SECRET           || crypto.randomBytes(32).toString("hex")
const BCRYPT_ROUNDS    = 10

// ─── In-memory fallback (untuk non-Supabase) ──────────────────────────────────
let memUsers = []

// ─── Helpers ──────────────────────────────────────────────────────────────────
function genId() { return crypto.randomBytes(12).toString("hex") }

function sanitize(s, max = 200) {
  if (typeof s !== "string") return ""
  return s.trim().replace(/<[^>]*>/g, "").replace(/\x00/g, "").slice(0, max)
}

function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "30d" })
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET) }
  catch { return null }
}

function validateEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) }
function validateUsername(u) { return /^[a-zA-Z0-9_]{3,30}$/.test(u) }
function validatePassword(p) { return typeof p === "string" && p.length >= 8 }

// ─── DB helpers ───────────────────────────────────────────────────────────────
async function findUserById(id) {
  if (USE_SUPABASE) {
    const { data } = await supabase.from("users").select("*").eq("id", id).single()
    return data || null
  }
  return memUsers.find(u => u.id === id) || null
}

async function findUserByField(field, value) {
  if (USE_SUPABASE) {
    const { data } = await supabase.from("users").select("*").eq(field, value).maybeSingle()
    return data || null
  }
  return memUsers.find(u => u[field] === value) || null
}

async function createUser(row) {
  if (USE_SUPABASE) {
    const { data, error } = await supabase.from("users").insert([row]).select().single()
    if (error) throw new Error(error.message)
    return data
  }
  memUsers.push(row)
  return row
}

async function updateUser(id, updates) {
  if (USE_SUPABASE) {
    const { data, error } = await supabase
      .from("users").update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id).select().single()
    if (error) throw new Error(error.message)
    return data
  }
  const idx = memUsers.findIndex(u => u.id === id)
  if (idx !== -1) Object.assign(memUsers[idx], updates)
  return memUsers[idx]
}

async function upsertOAuthUser(userData) {
  const existing = await findUserById(userData.id)
  const now = new Date().toISOString()

  if (existing) {
    // Update info terbaru dari OAuth provider
    return await updateUser(userData.id, {
      display_name: userData.displayName,
      avatar:       userData.avatar,
      bio:          existing.bio || "",
      updated_at:   now,
    })
  }

  return await createUser({
    id:           userData.id,
    provider:     userData.provider,
    username:     userData.username,
    display_name: userData.displayName,
    email:        userData.email || "",
    avatar:       userData.avatar || "",
    bio:          "",
    password_hash: null,
    created_at:   now,
    updated_at:   now,
  })
}

async function getUserStats(userId) {
  if (!USE_SUPABASE) return { snippetCount: 0, totalLikes: 0 }

  const [snipRes, likeRes] = await Promise.all([
    supabase.from("snippets").select("id", { count: "exact", head: true }).eq("author_id", userId),
    supabase.from("snippets").select("likes").eq("author_id", userId),
  ])

  const totalLikes = (likeRes.data || []).reduce((a, s) => a + (s.likes || 0), 0)
  return { snippetCount: snipRes.count || 0, totalLikes }
}

function formatUser(u, token = null) {
  const out = {
    id:          u.id,
    provider:    u.provider,
    username:    u.username,
    displayName: u.display_name,
    email:       u.email || "",
    avatar:      u.avatar || "",
    bio:         u.bio   || "",
    createdAt:   u.created_at,
  }
  if (token) out.token = token
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = function(app) {

  // ══════════════════════════════════════════════════════
  // POST /auth/register  — daftar email/password atau username/password
  // ══════════════════════════════════════════════════════
  app.post("/auth/register", async (req, res) => {
    try {
      const { username, email, password, displayName } = req.body

      if (!username || !password)
        return res.status(400).json({ success: false, error: "username dan password wajib" })
      if (!validateUsername(username))
        return res.status(400).json({ success: false, error: "Username hanya huruf, angka, underscore (3-30 karakter)" })
      if (!validatePassword(password))
        return res.status(400).json({ success: false, error: "Password minimal 8 karakter" })
      if (email && !validateEmail(email))
        return res.status(400).json({ success: false, error: "Format email tidak valid" })

      // Cek username duplikat
      const existingByUsername = await findUserByField("username", username.toLowerCase())
      if (existingByUsername)
        return res.status(409).json({ success: false, error: "Username sudah dipakai" })

      // Cek email duplikat
      if (email) {
        const existingByEmail = await findUserByField("email", email.toLowerCase())
        if (existingByEmail)
          return res.status(409).json({ success: false, error: "Email sudah terdaftar" })
      }

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
      const now = new Date().toISOString()
      const id  = "u_" + genId()

      const user = await createUser({
        id,
        provider:      "local",
        username:      sanitize(username.toLowerCase(), 30),
        display_name:  sanitize(displayName || username, 100),
        email:         email ? sanitize(email.toLowerCase(), 200) : "",
        avatar:        `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(username)}`,
        bio:           "",
        password_hash: passwordHash,
        created_at:    now,
        updated_at:    now,
      })

      const token = signToken(user.id)
      return res.status(201).json({ success: true, user: formatUser(user, token) })

    } catch (e) {
      console.error("Register error:", e.message)
      return res.status(500).json({ success: false, error: "Internal server error" })
    }
  })

  // ══════════════════════════════════════════════════════
  // POST /auth/login  — login email/username + password
  // ══════════════════════════════════════════════════════
  app.post("/auth/login", async (req, res) => {
    try {
      const { login, password } = req.body   // login = email atau username

      if (!login || !password)
        return res.status(400).json({ success: false, error: "login dan password wajib" })

      // Cari by email atau username
      let user = null
      if (validateEmail(login)) {
        user = await findUserByField("email", login.toLowerCase())
      }
      if (!user) {
        user = await findUserByField("username", login.toLowerCase())
      }

      if (!user || user.provider !== "local")
        return res.status(401).json({ success: false, error: "Akun tidak ditemukan" })
      if (!user.password_hash)
        return res.status(401).json({ success: false, error: "Akun ini login via OAuth" })

      const valid = await bcrypt.compare(password, user.password_hash)
      if (!valid)
        return res.status(401).json({ success: false, error: "Password salah" })

      const token = signToken(user.id)
      return res.json({ success: true, user: formatUser(user, token) })

    } catch (e) {
      console.error("Login error:", e.message)
      return res.status(500).json({ success: false, error: "Internal server error" })
    }
  })

  // ══════════════════════════════════════════════════════
  // POST /auth/github  — GitHub OAuth
  // ══════════════════════════════════════════════════════
  app.post("/auth/github", async (req, res) => {
    try {
      const { code } = req.body
      if (!code) return res.status(400).json({ success: false, error: "code wajib" })

      if (!GH_CLIENT_SECRET) {
        console.warn("⚠️  GITHUB_CLIENT_SECRET belum diset")
        return res.status(503).json({ success: false, error: "GitHub OAuth belum dikonfigurasi. Tambahkan GITHUB_CLIENT_SECRET di env vars." })
      }

      // Tukar code → access token
      const tokenRes = await axios.post(
        "https://github.com/login/oauth/access_token",
        { client_id: GH_CLIENT_ID, client_secret: GH_CLIENT_SECRET, code },
        { headers: { Accept: "application/json" }, timeout: 10000 }
      )
      const { access_token, error: ghErr } = tokenRes.data
      if (ghErr || !access_token) throw new Error(ghErr || "Gagal dapat token dari GitHub")

      // Ambil user + emails
      const [userRes, emailRes] = await Promise.all([
        axios.get("https://api.github.com/user", {
          headers: { Authorization: `Bearer ${access_token}`, "User-Agent": "ManzxyAPI/2.0" },
          timeout: 8000,
        }),
        axios.get("https://api.github.com/user/emails", {
          headers: { Authorization: `Bearer ${access_token}`, "User-Agent": "ManzxyAPI/2.0" },
          timeout: 8000,
        }).catch(() => ({ data: [] }))
      ])

      const gh = userRes.data
      const primaryEmail = emailRes.data?.find?.(e => e.primary)?.email || gh.email || ""

      const user = await upsertOAuthUser({
        id:          "gh_" + gh.id,
        provider:    "github",
        username:    gh.login,
        displayName: gh.name || gh.login,
        email:       primaryEmail,
        avatar:      gh.avatar_url || "",
        bio:         gh.bio || "",
      })

      const token = signToken(user.id)
      return res.json({ success: true, user: formatUser(user, token) })

    } catch (e) {
      console.error("GitHub auth error:", e.message)
      return res.status(500).json({ success: false, error: "GitHub login gagal" })
    }
  })

  // ══════════════════════════════════════════════════════
  // POST /auth/google  — Google OAuth (ID token)
  // ══════════════════════════════════════════════════════
  app.post("/auth/google", async (req, res) => {
    try {
      const { credential } = req.body
      if (!credential) return res.status(400).json({ success: false, error: "credential wajib" })

      let googleUser
      try {
        // Verifikasi via Google tokeninfo
        const verifyRes = await axios.get(
          `https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`,
          { timeout: 8000 }
        )
        googleUser = verifyRes.data
        if (GOOGLE_CLIENT_ID && googleUser.aud !== GOOGLE_CLIENT_ID)
          throw new Error("Token audience tidak cocok")
      } catch {
        // Fallback: decode JWT payload
        try {
          googleUser = JSON.parse(Buffer.from(credential.split(".")[1], "base64").toString())
        } catch {
          return res.status(400).json({ success: false, error: "Token Google tidak valid" })
        }
      }

      const user = await upsertOAuthUser({
        id:          "g_" + googleUser.sub,
        provider:    "google",
        username:    (googleUser.email || "user").split("@")[0].replace(/[^a-zA-Z0-9_]/g, "_"),
        displayName: googleUser.name || "Google User",
        email:       googleUser.email || "",
        avatar:      googleUser.picture || "",
        bio:         "",
      })

      const token = signToken(user.id)
      return res.json({ success: true, user: formatUser(user, token) })

    } catch (e) {
      console.error("Google auth error:", e.message)
      return res.status(500).json({ success: false, error: "Google login gagal" })
    }
  })

  // ══════════════════════════════════════════════════════
  // POST /auth/verify  — verifikasi JWT token
  // ══════════════════════════════════════════════════════
  app.post("/auth/verify", async (req, res) => {
    try {
      const { token } = req.body
      if (!token) return res.status(400).json({ success: false, error: "token wajib" })

      const decoded = verifyToken(token)
      if (!decoded) return res.status(401).json({ success: false, error: "Token tidak valid atau expired" })

      const user = await findUserById(decoded.sub)
      if (!user) return res.status(404).json({ success: false, error: "User tidak ditemukan" })

      const stats = await getUserStats(user.id)
      return res.json({ success: true, user: { ...formatUser(user), ...stats } })

    } catch (e) {
      return res.status(500).json({ success: false, error: "Internal server error" })
    }
  })

  // ══════════════════════════════════════════════════════
  // GET /auth/user/:id  — profil publik user
  // ══════════════════════════════════════════════════════
  app.get("/auth/user/:id", async (req, res) => {
    try {
      const user = await findUserById(req.params.id)
      if (!user) return res.status(404).json({ success: false, error: "User tidak ditemukan" })

      const stats = await getUserStats(user.id)
      return res.json({
        success: true,
        user: {
          id:           user.id,
          username:     user.username,
          displayName:  user.display_name,
          avatar:       user.avatar,
          bio:          user.bio,
          provider:     user.provider,
          createdAt:    user.created_at,
          snippetCount: stats.snippetCount,
          totalLikes:   stats.totalLikes,
        }
      })
    } catch (e) {
      return res.status(500).json({ success: false, error: "Internal server error" })
    }
  })

  // ══════════════════════════════════════════════════════
  // PUT /auth/user/:id  — update profil (bio, displayName, avatar)
  // ══════════════════════════════════════════════════════
  app.put("/auth/user/:id", async (req, res) => {
    try {
      // Verifikasi token
      const authHeader = req.headers.authorization || ""
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : req.body.token
      const decoded = verifyToken(token)
      if (!decoded || decoded.sub !== req.params.id)
        return res.status(403).json({ success: false, error: "Unauthorized" })

      const { displayName, bio, avatar } = req.body
      const updates = {}
      if (displayName !== undefined) updates.display_name = sanitize(displayName, 100)
      if (bio !== undefined)         updates.bio          = sanitize(bio, 300)
      if (avatar !== undefined)      updates.avatar       = sanitize(avatar, 500)

      const updated = await updateUser(req.params.id, updates)
      return res.json({ success: true, user: formatUser(updated) })

    } catch (e) {
      return res.status(500).json({ success: false, error: "Internal server error" })
    }
  })

  // ══════════════════════════════════════════════════════
  // PUT /auth/user/:id/password  — ganti password
  // ══════════════════════════════════════════════════════
  app.put("/auth/user/:id/password", async (req, res) => {
    try {
      const authHeader = req.headers.authorization || ""
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : req.body.token
      const decoded = verifyToken(token)
      if (!decoded || decoded.sub !== req.params.id)
        return res.status(403).json({ success: false, error: "Unauthorized" })

      const { oldPassword, newPassword } = req.body
      if (!oldPassword || !newPassword)
        return res.status(400).json({ success: false, error: "oldPassword dan newPassword wajib" })
      if (!validatePassword(newPassword))
        return res.status(400).json({ success: false, error: "Password baru minimal 8 karakter" })

      const user = await findUserById(req.params.id)
      if (!user || !user.password_hash)
        return res.status(400).json({ success: false, error: "Akun OAuth tidak punya password" })

      const valid = await bcrypt.compare(oldPassword, user.password_hash)
      if (!valid) return res.status(401).json({ success: false, error: "Password lama salah" })

      const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
      await updateUser(req.params.id, { password_hash: newHash })

      return res.json({ success: true, message: "Password berhasil diubah" })

    } catch (e) {
      return res.status(500).json({ success: false, error: "Internal server error" })
    }
  })

  // ══════════════════════════════════════════════════════
  // GET /auth/leaderboard  — top contributors by snippets + likes
  // ══════════════════════════════════════════════════════
  app.get("/auth/leaderboard", async (req, res) => {
    try {
      if (!USE_SUPABASE) return res.json({ success: true, users: [] })

      const { data: users } = await supabase
        .from("users")
        .select("id, username, display_name, avatar, bio, created_at")
        .limit(20)

      if (!users?.length) return res.json({ success: true, users: [] })

      const enriched = await Promise.all(users.map(async u => {
        const stats = await getUserStats(u.id)
        return {
          id:           u.id,
          username:     u.username,
          displayName:  u.display_name,
          avatar:       u.avatar,
          bio:          u.bio,
          snippetCount: stats.snippetCount,
          totalLikes:   stats.totalLikes,
        }
      }))

      enriched.sort((a, b) => (b.snippetCount * 2 + b.totalLikes) - (a.snippetCount * 2 + a.totalLikes))

      return res.json({ success: true, users: enriched.slice(0, 10) })
    } catch (e) {
      return res.status(500).json({ success: false, error: "Internal server error" })
    }
  })

}
