const fs = require('fs')
const path = require('path')

const xray = require('aws-xray-sdk')

module.exports = {
  setup: function (server, options) {
    const segmentName = options.segmentName || createSegmentName()
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

  createRequestHandler: () => {
    return async function (request, h) {
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
      ns.bindEmitter(request.raw.req)
      ns.bindEmitter(request.raw.res)
      const context = ns.createContext()
      ns.enter(context)
      request.context = context
      xray.setSegment(segment)

      return h.continue
    }
  },

  createResponseHandler: () => {
    return async function (request, h) {
      const ns = xray.getNamespace()

      if (request.response.isBoom && xray.utils.getCauseTypeFromHttpStatus(request.response.output.statusCode)) {
        if (request.response.output.statusCode === 429) {
          request.segment.addThrottleFlag()
        }
        request.segment[xray.utils.getCauseTypeFromHttpStatus(request.response.output.statusCode)] = true
        close({ ns, request, err: request.response })
        return h.continue
      }

      if (!request.segment) {
        return h.continue
      }

      close({ ns, request })
      return h.continue
    }
  }
}

function createSegmentName () {
  let segmentName = 'service'
  const pkgPath = path.join(process.cwd(), 'package.json')
  if (fs.existsSync(pkgPath)) {
    const pjson = require(pkgPath)
    segmentName = `${pjson.name || 'service'}_${pjson.version || 'v1'}`
  }
  return segmentName
}

function close ({ ns, request, err }) {
  request.segment.http.close(request.response)
  request.segment.close(err)
  ns.exit(request.context)
  request.segment = null
  request.context = null
}
