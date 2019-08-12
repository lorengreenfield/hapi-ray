const xray = require('./xray')

module.exports = {
  register: (server, options) => {
    xray.setup(server, options)

    server.ext({
      type: 'onPreResponse',
      method: xray.createResponseHandler()
    })
  }
}
