const { register } = require('./plugin')
const pack = require('./package')

module.exports = {
  plugin: {
    register,
    name: 'hapi-ray',
    version: pack.version
  }
}
