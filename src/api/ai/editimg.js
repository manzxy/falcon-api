const axios = require("axios")
const CryptoJS = require("crypto-js")

const AES_KEY = "ai-enhancer-web__aes-key"
const AES_IV = "aienhancer-aesiv"

function encrypt(obj) {
  return CryptoJS.AES.encrypt(
    JSON.stringify(obj),
    CryptoJS.enc.Utf8.parse(AES_KEY),
    {
      iv: CryptoJS.enc.Utf8.parse(AES_IV),
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    }
  ).toString()
}

module.exports = function (app) {
  app.get("/ai/editimg", async (req, res) => {
    const { image, text } = req.query

    if (!image || !text) {
      return res.status(400).json({
        success: false,
        creator: "manzxy",
        message: "Parameter 'image' dan 'text' wajib diisi."
      })
    }

    try {
      // Ambil gambar dari URL
      const imgRes = await axios.get(image, {
        responseType: "arraybuffer"
      })
      const base64 = Buffer.from(imgRes.data).toString("base64")

      const settings = encrypt({
        prompt: text,
        size: "2K",
        aspect_ratio: "match_input_image",
        output_format: "jpeg",
        max_images: 1
      })

      const headers = {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10)",
        "Content-Type": "application/json",
        Origin: "https://aienhancer.ai",
        Referer: "https://aienhancer.ai/ai-image-editor"
      }

      const create = await axios.post(
        "https://aienhancer.ai/api/v1/k/image-enhance/create",
        {
          model: 2,
          image: `data:image/jpeg;base64,${base64}`,
          settings
        },
        { headers }
      )

      const taskId = create.data.data.id

      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 2500))

        const r = await axios.post(
          "https://aienhancer.ai/api/v1/k/image-enhance/result",
          { task_id: taskId },
          { headers }
        )

        const data = r.data.data

        if (data.status === "success") {
          return res.json({
            success: true,
            creator: "manzxy",
            id: taskId,
            result: {
              input: data.input,
              output: data.output
            }
          })
        }

        if (data.status === "failed") {
          return res.json({
            success: false,
            creator: "manzxy",
            message: data.error || "Proses gagal"
          })
        }
      }

      return res.json({
        success: false,
        creator: "manzxy",
        message: "Timeout menunggu hasil"
      })
    } catch (e) {
      return res.status(500).json({
        success: false,
        creator: "manzxy",
        message: "Gagal memproses gambar",
        error: e.message
      })
    }
  })
}
