const axios = require("axios")

module.exports = function (app) {
  app.get("/stalker/github", async (req, res) => {
    const { username } = req.query

    if (!username) {
      return res.status(400).json({
        success: false,
        creator: "manzxy",
        message: "Parameter 'username' wajib diisi."
      })
    }

    try {
      const { data } = await axios.get(
        "https://api.github.com/users/" + username,
        {
          headers: {
            "User-Agent": "Mozilla/5.0"
          }
        }
      )

      return res.json({
        success: true,
        creator: "manzxy",
        result: {
          username: data.login,
          nickname: data.name,
          bio: data.bio,
          id: data.id,
          node_id: data.node_id,
          profile_pic: data.avatar_url,
          url: data.html_url,
          type: data.type,
          admin: data.site_admin,
          company: data.company,
          blog: data.blog,
          location: data.location,
          email: data.email,
          public_repo: data.public_repos,
          public_gists: data.public_gists,
          followers: data.followers,
          following: data.following,
          created_at: data.created_at,
          updated_at: data.updated_at
        }
      })
    } catch (e) {
      return res.status(500).json({
        success: false,
        creator: "manzxy",
        message: "Gagal mengambil data GitHub user.",
        error: e.message
      })
    }
  })
}
