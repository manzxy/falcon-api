const axios = require("axios")
const cheerio = require("cheerio")

module.exports = function (app) {
  app.get("/search/fdroid", async (req, res) => {
    const { q } = req.query

    if (!q) {
      return res.status(400).json({
        success: false,
        creator: "manzxy",
        message: "Parameter 'q' wajib diisi."
      })
    }

    try {
      const url = `https://search.f-droid.org/?q=${encodeURIComponent(q)}&lang=id`
      const { data } = await axios.get(url)

      const $ = cheerio.load(data)
      const results = []

      $("a.package-header").each((_, el) => {
        results.push({
          icon: $(el).find("img.package-icon").attr("src") || null,
          name: $(el).find("h4.package-name").text().trim() || null,
          summary: $(el).find(".package-summary").text().trim() || null,
          license: $(el).find(".package-license").text().trim() || null,
          link: $(el).attr("href") || null
        })
      })

      if (!results.length) {
        return res.json({
          success: false,
          creator: "manzxy",
          message: "Aplikasi tidak ditemukan."
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
        message: "Gagal melakukan pencarian F-Droid.",
        error: e.message
      })
    }
  })
}
