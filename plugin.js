const xray = require('./xray')

module.exports = {
  register: (server, options) => {
    xray.setup(options)

    server.ext({
      type: 'onRequest',
      method: xray.createRequestHandler()
    })
  }
}
