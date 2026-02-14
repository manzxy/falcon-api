const axios = require('axios');

async function tebakgambar() {
    const config = {
        method: 'GET',
        url: 'https://raw.githubusercontent.com/manzxy/dbgame/main/tebakgambar.json',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Android 10; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
            'Accept': 'application/json',
        }
    };

    const response = await axios.request(config);
    return response.data;
}

module.exports = function (app) {
    app.get('/game/tebakgambar', async (req, res) => {
        try {
            const { level } = req.query;
            const results = await tebakgambar();
            
            let data = results;
            
            // Filter per level (setiap level 20 soal)
            if (level) {
                const start = (level - 1) * 20;
                const end = level * 20;
                data = results.slice(start, end);
            }
            
            res.status(200).json({
                status: true,
                total: data.length,
                result: data
            });
            
        } catch (error) {
            res.status(500).json({
                status: false,
                message: `Error: ${error.message}`
            });
        }
    });
}
