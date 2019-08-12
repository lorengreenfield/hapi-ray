const fs = require('fs')
const path = require('path')

const xray = require('aws-xray-sdk')

// Setup XRay
xray.capturePromise()

module.exports = {
  setup: function (server, options) {
    const segmentName = options.segmentName || this._createSegmentName()
    xray.middleware.setDefaultName(segmentName)

    if (options.plugins) {
      xray.config(options.plugins)
    }

    if (options.logger) {
      xray.setLogger(options.logger)
    }

    if (options.captureAWS) {
      xray.captureAWS(require('aws-sdk'))
    }
  },

  createResponseHandler: function () {
    return async (request, h) => {
      const header = xray.middleware.processHeaders(request)
      const name = xray.middleware.resolveName(request.headers.host)

      const segment = new xray.Segment(name, header.Root, header.Parent)
      request.segment = segment

      xray.middleware.resolveSampling(header, segment, {
        req: request.raw.req
      })

      segment.addIncomingRequestData(
        new xray.middleware.IncomingRequestData(request.raw.req)
      )

      xray.getLogger().debug(`Starting hapi segment: {
  url: ${request.url.toString()},
  name: ${segment.name},
  trace_id: ${segment.trace_id},
  id: ${segment.id},
  sampled: ${!segment.notTraced}
}`)

      const ns = xray.getNamespace()
      const context = ns.createContext()

      ns.bindEmitter(request.raw.req)
      ns.bindEmitter(request.raw.res)

      ns.enter(context)

      xray.setSegment(segment)

      if(!request.response || !request.response.events){
        return h.continue
      }

      request.response.events.once('finish', function () {
        if (!request.segment) {
          return
        }

        if (request.response.statusCode === 429) {
          request.segment.addThrottleFlag()
        }

        if (request.response && request.response.isBoom && request.response.statusCode !== 404) {
          const cause = xray.utils.getCauseTypeFromHttpStatus(
            request.response.statusCode
          )

          if (cause) {
            request.segment[cause] = true
          }

          request.segment.close(request.response)

          xray.getLogger().debug(`Closed hapi segment with error: {
  url: ${request.url.toString()},
  name: ${request.segment.name},
  trace_id: ${request.segment.trace_id},
  id: ${request.segment.id},
  sampled: ${!request.segment.notTraced}
}`)
        } else {
          request.segment.close()

          xray.getLogger().debug(`Closed hapi segment: {
  url: ${request.url.toString()},
  name: ${request.segment.name},
  trace_id: ${request.segment.trace_id},
  id: ${request.segment.id},
  sampled: ${!request.segment.notTraced}
}`)
        }
      })

      return h.continue
    }
  },

  _createSegmentName: function () {
    let segmentName = 'service'
    const pkgPath = path.join(process.cwd(), 'package.json')
    if (fs.existsSync(pkgPath)) {
      const pjson = require(pkgPath)
      segmentName = `${pjson.name || 'service'}_${pjson.version || 'v1'}`
    }
    return segmentName
  }
}
