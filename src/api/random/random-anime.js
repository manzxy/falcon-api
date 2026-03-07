const axios = require("axios")

const BASE_URL =
  "https://www.generatormix.com/random-anime-character-generator"

async function getRandomAnimeChar() {
  // ── Step 1: GET halaman untuk ambil cookie + CSRF token ──
  const session = await axios.get(BASE_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "Accept-Encoding": "gzip, deflate, br"
    }
  })

  // Gabungkan semua cookie
  const rawCookies = session.headers["set-cookie"] || []
  const cookie = rawCookies
    .map((c) => c.split(";")[0])
    .join("; ")

  // generatormix pakai Laravel — CSRF di <meta name="csrf-token" content="...">
  const token = session.data.match(
    /<meta\s+name="csrf-token"\s+content="([^"]+)"/
  )?.[1]

  if (!token) {
    // fallback: coba cari di input hidden _token
    const tokenFallback = session.data.match(
      /name="_token"\s+value="([^"]+)"/
    )?.[1]
    if (!tokenFallback)
      throw new Error("CSRF token not found")
    return _doPost(tokenFallback, cookie)
  }

  return _doPost(token, cookie)
}

async function _doPost(token, cookie) {
  // ── Step 2: POST dengan _token di body (Laravel style) ──
  const body = new URLSearchParams({
    _token: token,           // Laravel butuh _token di body
    number_of_results: "1"
  }).toString()

  const { data } = await axios.post(BASE_URL, body, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Referer: BASE_URL,
      Origin: "https://www.generatormix.com",
      "X-CSRF-TOKEN": token,
      "X-Requested-With": "XMLHttpRequest",
      Cookie: cookie,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.5"
    }
  })

  // ── Step 3: Parse response ──
  // Response bisa berupa: { output: "<html>..." } atau { results: [...] }
  const html =
    typeof data === "string"
      ? data
      : data.output || data.html || data.result || ""

  if (!html) throw new Error("Empty response from server")

  // Coba berbagai format atribut gambar
  // generatormix pakai lazy-load: data-src atau data-lazy-src
  const imgMatch =
    html.match(/data-src="(\/images\/[^"]+)"/) ||
    html.match(/data-lazy-src="(\/images\/[^"]+)"/) ||
    html.match(/data-src="(https?:\/\/[^"]+)"/) ||
    html.match(/src="(\/images\/[^"]+)"/) ||
    html.match(/<img[^>]+src="(https?:\/\/(?:www\.)?generatormix\.com[^"]+)"/)

  if (!imgMatch) throw new Error("Image not found in response")

  const imgPath = imgMatch[1]

  // Tambah domain jika path relatif
  const image = imgPath.startsWith("http")
    ? imgPath
    : "https://www.generatormix.com" + imgPath

  return image
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
