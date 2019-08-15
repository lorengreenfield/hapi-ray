const xray = require('./xray')

module.exports = {
  register: (server, options) => {
    xray.setup(server, options)

    server.ext({
      type: 'onRequest',
      method: xray.createRequestHandler()
    })

    server.ext({
      type: 'onPreResponse',
      method: xray.createResponseHandler()
    })
  }
}
