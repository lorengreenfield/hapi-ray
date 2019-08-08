const fs = require('fs')
const path = require('path')

const xray = require('aws-xray-sdk')

// Setup XRay
xray.capturePromise()

module.exports = {
  setup: function (options) {
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

  createRequestHandler: function () {
    return async (request, h) => {
      const header = xray.middleware.processHeaders(request)
      const name = xray.middleware.resolveName(request.headers.host)

      const segment = new xray.Segment(name, header.Root, header.Parent)

      xray.middleware.resolveSampling(header, segment, {
        req: request.raw.req
      })

      segment.addIncomingRequestData(
        new xray.middleware.IncomingRequestData(request.raw.req)
      )

      request.segment = segment

      xray.getLogger().debug(`Starting hapi segment: {
        url: ${request.url},
        name: ${segment.name},
        trace_id: ${segment.trace_id},
        id: ${segment.id},
        sampled: ${!segment.notTraced}
      }`)

      request.server.events.once('response', req => {
        if (req.response.statusCode === 429) {
          req.segment.addThrottleFlag()
        }

        const cause = xray.utils.getCauseTypeFromHttpStatus(
          req.response.statusCode
        )

        if (cause) {
          req.segment[cause] = true
        }

        if (req.response && req.response._error && req.response.statusCode !== 404) {
          req.segment.addError(req.response._error)
        }

        req.segment.http.close(req.raw.res)
        req.segment.close()

        xray.getLogger().debug(`Closed hapi segment successfully: {
          url: ${req.url},
          name: ${req.segment.name},
          trace_id: ${req.segment.trace_id},
          id: ${req.segment.id},
          sampled: ${!req.segment.notTraced}
        }`)
      })

      const ns = xray.getNamespace()
      const context = ns.createContext()

      ns.bindEmitter(request.raw.req)
      ns.bindEmitter(request.raw.res)

      ns.enter(context)

      xray.setSegment(segment)

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
