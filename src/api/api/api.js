module.exports = function (app) {

  /* ======================
     UTIL
  ====================== */
  function runtime(seconds) {
    seconds = Number(seconds)
    const d = Math.floor(seconds / (3600 * 24))
    const h = Math.floor(seconds % (3600 * 24) / 3600)
    const m = Math.floor(seconds % 3600 / 60)
    const s = Math.floor(seconds % 60)
    return `${d}d ${h}h ${m}m ${s}s`
  }

  function listRoutes() {
    return app._router.stack
      .filter(layer => layer.route)
      .map(layer => ({
        method: Object.keys(layer.route.methods).join(', ').toUpperCase(),
        path: layer.route.path
      }))
  }

  /* ======================
     API STATUS
  ====================== */
  app.get('/api/status', async (req, res) => {
    try {
      res.status(200).json({
        status: true,
        result: {
          api_status: "ONLINE",
          total_request: global.totalreq?.toString() || "0",
          total_fitur: listRoutes().length,
          runtime: runtime(process.uptime()),
          domain: req.hostname
        }
      })
    } catch (e) {
      res.status(500).json({
        status: false,
        message: e.message
      })
    }
  })

  /* ======================
     API DASHBOARD (DETAIL)
  ====================== */
  app.get('/api/dashboard', async (req, res) => {
    try {
      const os = require('os')
      const memUsed = (os.totalmem() - os.freemem()) / 1024 / 1024
      const memTotal = os.totalmem() / 1024 / 1024

      res.status(200).json({
        status: true,
        result: {
          api: {
            status: "ONLINE",
            total_request: global.totalreq?.toString() || "0",
            total_fitur: listRoutes().length,
            runtime: runtime(process.uptime()),
            domain: req.hostname,
            timestamp: new Date().toISOString()
          },
          server: {
            platform: os.platform(),
            arch: os.arch(),
            cpu: os.cpus()[0]?.model || "-",
            cores: os.cpus().length,
            memory: {
              used_mb: memUsed.toFixed(0),
              total_mb: memTotal.toFixed(0)
            },
            node_version: process.version
          }
        }
      })
    } catch (e) {
      res.status(500).json({
        status: false,
        message: e.message
      })
    }
  })

  /* ======================
     API ROUTE LIST (OPSIONAL)
  ====================== */
  app.get('/api/routes', async (req, res) => {
    try {
      res.status(200).json({
        status: true,
        total: listRoutes().length,
        routes: listRoutes()
      })
    } catch (e) {
      res.status(500).json({
        status: false,
        message: e.message
      })
    }
  })

}
