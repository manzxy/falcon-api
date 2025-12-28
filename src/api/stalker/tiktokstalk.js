const axios = require("axios")
const cheerio = require("cheerio")

module.exports = function (app) {
  app.get("/tools/tiktok-user", async (req, res) => {
    const { username } = req.query

    if (!username) {
      return res.status(400).json({
        success: false,
        creator: "manzxy",
        message: "Parameter 'username' wajib diisi."
      })
    }

    try {
      const cleanUsername = username.replace(/^@/, "").trim()
      const url = `https://www.tiktok.com/@${cleanUsername}`

      const { data } = await axios.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
          Accept: "text/html",
          Referer: "https://www.tiktok.com/"
        },
        timeout: 10000
      })

      const $ = cheerio.load(data)

      const scriptData = $("#__UNIVERSAL_DATA_FOR_REHYDRATION__").html()
      if (!scriptData) {
        return res.json({
          success: false,
          creator: "manzxy",
          message:
            "Gagal mengambil data. Struktur TikTok kemungkinan berubah."
        })
      }

      const parsed = JSON.parse(scriptData)
      const userDetail =
        parsed.__DEFAULT_SCOPE__?.["webapp.user-detail"]
      const userInfo = userDetail?.userInfo

      if (!userInfo || !userInfo.user) {
        return res.json({
          success: false,
          creator: "manzxy",
          message: "User tidak ditemukan atau akun private."
        })
      }

      return res.json({
        success: true,
        creator: "manzxy",
        result: {
          user: userInfo.user,
          stats: userInfo.stats,
          shareMeta: userDetail?.shareMeta || null
        }
      })
    } catch (e) {
      return res.status(500).json({
        success: false,
        creator: "manzxy",
        message: "Gagal mengambil data TikTok user.",
        error: e.message
      })
    }
  })
        }
