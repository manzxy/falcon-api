const axios = require("axios")

module.exports = function (app) {
  app.get("/ai/webpilot", async (req, res) => {
    const { text } = req.query

    if (!text) {
      return res.status(400).json({
        success: false,
        creator: "manzxy",
        message: "Parameter 'text' wajib diisi."
      })
    }

    try {
      const r = await axios.post(
        "https://api.webpilotai.com/rupee/v1/search",
        { q: text, threadId: "" },
        {
          responseType: "stream",
          headers: {
            "User-Agent": "Mozilla/5.0 (Linux; Android 10)",
            Accept:
              "application/json,text/plain,*/*,text/event-stream",
            "Content-Type": "application/json",
            authorization: "Bearer null",
            origin: "https://www.webpilot.ai"
          }
        }
      )

      let answer = ""
      let sources = []

      r.data.on("data", chunk => {
        const lines = chunk.toString().split("\n")

        for (const l of lines) {
          if (!l.startsWith("data:")) continue

          try {
            const j = JSON.parse(l.slice(5).trim())

            if (
              j.type === "data" &&
              j.data?.content &&
              !j.data.section_id
            ) {
              answer += j.data.content
            }

            if (j.action === "using_internet" && j.data) {
              sources.push(j.data)
            }
          } catch {}
        }
      })

      r.data.on("end", () => {
        return res.json({
          success: true,
          creator: "manzxy",
          result: answer.trim(),
          sources
        })
      })
    } catch (e) {
      return res.status(500).json({
        success: false,
        creator: "manzxy",
        message: "Gagal mengambil data dari WebPilot.",
        error: e.message
      })
    }
  })
}
