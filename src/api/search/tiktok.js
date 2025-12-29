const axios = require("axios")

module.exports = function (app) {
  app.get("/search/tiktok", async (req, res) => {
    const { q, limit } = req.query

    if (!q) {
      return res.status(400).json({
        success: false,
        creator: "manzxy",
        message: "Parameter 'q' wajib diisi."
      })
    }

    try {
      const url = "https://tikwm.com/api/feed/search"

      const params = new URLSearchParams()
      params.append("keywords", q)
      params.append("count", limit || "12")
      params.append("cursor", "0")
      params.append("web", "1")
      params.append("hd", "1")

      const { data } = await axios.post(url, params.toString(), {
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded; charset=UTF-8",
          Accept:
            "application/json, text/javascript, */*; q=0.01",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      })

      if (data.code !== 0 || !data.data?.videos) {
        return res.json({
          success: false,
          creator: "manzxy",
          message: "Gagal mengambil data video TikTok."
        })
      }

      const results = data.data.videos.map(v => ({
        title: v.title || null,
        author: v.author?.nickname || null,
        duration: v.duration,
        video: `https://tikwm.com${v.play}`,
        music: `https://tikwm.com${v.music}`,
        cover: v.cover
      }))

      return res.json({
        success: true,
        creator: "manzxy",
        query: q,
        total: results.length,
        result: results
      })
    } catch (e) {
      return res.status(500).json({
        success: false,
        creator: "manzxy",
        message: "Gagal melakukan pencarian TikTok.",
        error: e.message
      })
    }
  })
       }
