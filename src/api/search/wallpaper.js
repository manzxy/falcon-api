const axios = require("axios")
const cheerio = require("cheerio")

module.exports = function (app) {
  app.get("/search/wallpaper", async (req, res) => {
    const { q } = req.query

    if (!q) {
      return res.status(400).json({
        success: false,
        creator: "manzxy",
        message: "Parameter 'q' wajib diisi."
      })
    }

    try {
      const url = `https://www.wallpaperflare.com/search?wallpaper=${encodeURIComponent(q)}`

      const { data } = await axios.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      })

      const $ = cheerio.load(data)
      const results = []

      $('li[itemprop="associatedMedia"]').each((_, el) => {
        const title = $(el)
          .find('figcaption[itemprop="caption description"]')
          .text()
          .trim()

        const image = $(el).find("img").attr("data-src")
        const page = $(el).find('a[itemprop="url"]').attr("href")
        const resolution = $(el).find(".res").text().trim()

        if (image && page) {
          results.push({
            title: title || null,
            resolution: resolution || null,
            image,
            page: `https://www.wallpaperflare.com${page}`
          })
        }
      })

      if (!results.length) {
        return res.json({
          success: false,
          creator: "manzxy",
          message: "Tidak ditemukan wallpaper."
        })
      }

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
        message: "Gagal mengambil wallpaper.",
        error: e.message
      })
    }
  })
}
