const axios = require("axios")

const BASE_URL =
  "https://www.generatormix.com/random-anime-character-generator"

async function getRandomAnimeChar() {
  // ambil session + csrf
  const session = await axios.get(BASE_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: BASE_URL
    }
  })

  const cookie = session.headers["set-cookie"]?.join("; ")
  const token = session.data.match(
    /name="csrf-token" content="(.*?)"/
  )?.[1]

  if (!token) throw new Error("CSRF token not found")

  // request 1 karakter
  const { data } = await axios.post(
    BASE_URL,
    "number_of_results=1",
    {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: BASE_URL,
        "X-CSRF-TOKEN": token,
        "X-Requested-With": "XMLHttpRequest",
        Cookie: cookie,
        "Content-Type":
          "application/x-www-form-urlencoded"
      }
    }
  )

  const img = data.output?.match(/data-src="(.*?)"/)?.[1]
  if (!img) throw new Error("Image not found")

  return "https://www.generatormix.com" + img
}

module.exports = function (app) {
  app.get("/random/anime", async (req, res) => {
    try {
      const image = await getRandomAnimeChar()

      return res.json({
        success: true,
        creator: "manzxy",
        result: {
          image
        }
      })
    } catch (e) {
      return res.status(500).json({
        success: false,
        creator: "manzxy",
        message: "Gagal mengambil karakter anime.",
        error: e.message
      })
    }
  })
}
