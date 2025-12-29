const axios = require("axios")
const FormData = require("form-data")

module.exports = function (app) {
  app.get("/ai/hdr", async (req, res) => {
    const { image } = req.query

    if (!image) {
      return res.status(400).json({
        success: false,
        creator: "manzxy",
        message: "Parameter 'image' wajib diisi (URL gambar)."
      })
    }

    try {
      /* =========================
         UPLOAD IMAGE (via URL)
      ========================= */
      const form = new FormData()
      form.append("url", image)
      form.append("type", 13)
      form.append("scaleRadio", 2)

      const uploadHeaders = {
        ...form.getHeaders(),
        accept: "application/json, text/plain, */*",
        origin: "https://imglarger.com",
        referer: "https://imglarger.com/",
        "user-agent":
          "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120 Mobile"
      }

      const uploadRes = await axios.post(
        "https://photoai.imglarger.com/api/PhoAi/Upload",
        form,
        { headers: uploadHeaders }
      )

      const code = uploadRes.data?.data?.code
      if (!code) throw new Error("Gagal upload gambar.")

      /* =========================
         CHECK STATUS (POLLING)
      ========================= */
      const checkHeaders = {
        accept: "application/json, text/plain, */*",
        "content-type": "application/json",
        origin: "https://imglarger.com",
        referer: "https://imglarger.com/",
        "user-agent":
          "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120 Mobile"
      }

      let result
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 6000))

        const { data } = await axios.post(
          "https://photoai.imglarger.com/api/PhoAi/CheckStatus",
          { code, type: 13 },
          { headers: checkHeaders }
        )

        result = data.data
        if (result.status !== "waiting") break
      }

      if (!result || result.status !== "success") {
        return res.json({
          success: false,
          creator: "manzxy",
          message: "Proses upscale gagal atau timeout."
        })
      }

      return res.json({
        success: true,
        creator: "manzxy",
        input: image,
        result
      })
    } catch (e) {
      return res.status(500).json({
        success: false,
        creator: "manzxy",
        message: "Gagal melakukan image upscale.",
        error: e.message
      })
    }
  })
        }
