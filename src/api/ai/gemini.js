const fetch = require("node-fetch")

class GeminiClient {
  constructor() {
    this.s = null
    this.r = 1
  }

  async init() {
    const res = await fetch("https://gemini.google.com/", {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/137 Mobile"
      }
    })

    const h = await res.text()
    this.s = {
      a: h.match(/"SNlM0e":"(.*?)"/)?.[1] || "",
      b: h.match(/"cfb2h":"(.*?)"/)?.[1] || "",
      c: h.match(/"FdrFJe":"(.*?)"/)?.[1] || ""
    }
  }

  async ask(msg, sys = "kamu adalah siputzx production") {
    if (!this.s) await this.init()

    const payload = [
      null,
      JSON.stringify([
        [msg, 0, null, null, null, null, 0],
        ["id"],
        ["", "", "", null, null, null, null, null, null, ""],
        null, null, null, [1], 1, null, null, 1, 0, null, null,
        null, null, null, [[0]], 1, null, null, null, null, null,
        ["", "", sys, null, null, null, null, null, 0, null, 1, null, null, null, []],
        null, null, 1, null, null, null, null, null, null, null,
        [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20],
        1, null, null, null, null, [1]
      ])
    ]

    const q = `bl=${this.s.b}&f.sid=${this.s.c}&hl=id&_reqid=${this.r++}&rt=c`

    const res = await fetch(
      `https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?${q}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          "user-agent":
            "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/137 Mobile",
          "x-same-domain": "1"
        },
        body: `f.req=${encodeURIComponent(JSON.stringify(payload))}&at=${this.s.a}`
      }
    )

    const text = await res.text()
    const lines = text.split("\n")
    const out = []

    for (const ln of lines) {
      if (!ln.startsWith('[["wrb.fr"')) continue
      try {
        const jsonStr = JSON.parse(ln)[0][2]
        const d = JSON.parse(jsonStr)
        if (Array.isArray(d?.[4])) {
          for (const it of d[4]) {
            const t = it?.[1]?.[0]
            if (typeof t === "string") out.push(t)
          }
        }
      } catch {}
    }

    if (!out.length) return null
    return out[out.length - 1].replace(/\\n/g, "\n")
  }
}

const gemini = new GeminiClient()

module.exports = function (app) {
  app.get("/ai/gemini-web", async (req, res) => {
    const { text, system } = req.query

    if (!text) {
      return res.status(400).json({
        success: false,
        message: "Parameter 'text' wajib diisi."
      })
    }

    try {
      const result = await gemini.ask(
        text,
        system || "kamu adalah siputzx production"
      )

      if (!result) {
        return res.json({
          success: false,
          message: "Tidak ada respon dari Gemini."
        })
      }

      return res.json({
        success: true,
        result
      })
    } catch (e) {
      return res.status(500).json({
        success: false,
        message: "Gagal mengambil respon Gemini.",
        error: e.message
      })
    }
  })
}
