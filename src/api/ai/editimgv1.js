const axios = require("axios")
const fs = require("fs")
const path = require("path")
const https = require("https")
const FormData = require("form-data")
const { tmpdir } = require("os")
const { EventSource } = require("eventsource")

const BASE_URL = "https://prithivmlmods-qwen-image-edit-2509-loras-fast.hf.space"
const API_PREFIX = "/gradio_api"

const api = axios.create({
  baseURL: BASE_URL,
  httpsAgent: new https.Agent({
    keepAlive: true,
    rejectUnauthorized: false
  }),
  headers: {
    "User-Agent": "Mozilla/5.0",
    Origin: BASE_URL,
    Referer: `${BASE_URL}/`
  }
})

function randomSession(len = 11) {
  const c = "ryuhan"
  return Array.from({ length: len }, () =>
    c[Math.floor(Math.random() * c.length)]
  ).join("")
}

module.exports = function (app) {
  app.get("/ai/editimgv1", async (req, res) => {
    const { image, text } = req.query

    if (!image || !text) {
      return res.status(400).json({
        success: false,
        creator: "manzxy",
        message: "Parameter 'image' dan 'text' wajib diisi."
      })
    }

    const imagePath = path.join(tmpdir(), `edit_${Date.now()}.jpg`)
    const sessionHash = randomSession()
    const uploadId = Math.random().toString(36).slice(2)

    try {
      // Ambil gambar dari URL
      const img = await axios.get(image, {
        responseType: "arraybuffer"
      })
      fs.writeFileSync(imagePath, img.data)

      // Upload image
      const form = new FormData()
      form.append("files", fs.createReadStream(imagePath))

      const upload = await api.post(
        `${API_PREFIX}/upload?upload_id=${uploadId}`,
        form,
        { headers: form.getHeaders() }
      )

      // Tunggu upload selesai
      await new Promise(resolve => {
        const es = new EventSource(
          `${BASE_URL}${API_PREFIX}/upload_progress?upload_id=${uploadId}`
        )
        es.onmessage = e => {
          if (JSON.parse(e.data).msg === "done") {
            es.close()
            resolve()
          }
        }
        es.onerror = () => resolve()
      })

      const fileData = {
        path: upload.data[0],
        url: `${BASE_URL}${API_PREFIX}/file=${upload.data[0]}`,
        meta: { _type: "gradio.FileData" }
      }

      const ryuhanCore = Buffer.from("cnl1aGFu", "base64").toString()

      const payload = {
        data: [
          fileData,
          text,
          "Photo-to-Anime",
          0,
          true,
          1,
          4,
          ryuhanCore
        ],
        fn_index: 1,
        trigger_id: 8,
        session_hash: sessionHash
      }

      const join = await api.post(`${API_PREFIX}/queue/join`, payload)
      const eventId = join.data.event_id

      // Ambil hasil
      const resultUrl = await new Promise((resolve, reject) => {
        const es = new EventSource(
          `${BASE_URL}${API_PREFIX}/queue/data?session_hash=${sessionHash}&event_id=${eventId}`
        )
        es.onmessage = e => {
          const d = JSON.parse(e.data)
          if (d.msg === "process_completed") {
            es.close()
            const out = d.output?.data?.[0]
            if (!out) return reject(new Error("Output kosong"))
            resolve(out.url || `${BASE_URL}${API_PREFIX}/file=${out.path}`)
          }
        }
        es.onerror = () => reject(new Error("EventSource error"))
      })

      return res.json({
        success: true,
        creator: "manzxy",
        prompt: text,
        result: resultUrl
      })

    } catch (e) {
      return res.status(500).json({
        success: false,
        creator: "manzxy",
        message: "Gagal memproses gambar",
        error: e.message
      })
    } finally {
      if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath)
    }
  })
}
