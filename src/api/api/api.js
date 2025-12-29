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
        method: Object.keys(layer.route.methods)
          .join(',')
          .toUpperCase(),
        path: layer.route.path
      }))
  }

  /* ======================
     API STATUS (UMUM)
  ====================== */
  app.get('/api/status', (req, res) => {
    res.json({
      success: true,
      api: {
        status: 'ONLINE',
        uptime: runtime(process.uptime()),
        totalRequest: global.totalreq || 0,
        totalEndpoint: listRoutes().length,
        domain: req.hostname
      }
    })
  })

  /* ======================
     API INFO (DETAIL)
  ====================== */
  app.get('/api/info', (req, res) => {
    res.json({
      success: true,
      api: {
        name: global.apiName || 'Manzxy API',
        version: global.apiVersion || 'v1',
        environment: process.env.NODE_ENV || 'production',
        baseUrl: `${req.protocol}://${req.get('host')}`,
        uptime: runtime(process.uptime())
      },
      server: {
        platform: process.platform,
        node: process.version,
        memory: {
          used: `${(process.memoryUsage().rss / 1024 / 1024).toFixed(0)} MB`,
          total: `${(require('os').totalmem() / 1024 / 1024).toFixed(0)} MB`
        }
      }
    })
  })

  /* ======================
     API FEATURES / ROUTES
  ====================== */
  app.get('/api/features', (req, res) => {
    const routes = listRoutes()

    res.json({
      success: true,
      total: routes.length,
      result: routes
    })
  })

  /* ======================
     API STATS
  ====================== */
  app.get('/api/stats', (req, res) => {
    res.json({
      success: true,
      stats: {
        totalRequest: global.totalreq || 0,
        uptime: runtime(process.uptime()),
        avgRequestPerMinute: global.totalreq
          ? Math.floor(global.totalreq / (process.uptime() / 60))
          : 0
      }
    })
  })

  /* ======================
     HEALTH CHECK
  ====================== */
  app.get('/api/health', (req, res) => {
    res.json({
      success: true,
      status: 'OK',
      timestamp: Date.now()
    })
  })
        }
