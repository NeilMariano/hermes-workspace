// hermes-bridge: forwards the Workspace's requests to the Hermes services on your
// Windows PC, and rewrites the Host header to 127.0.0.1:<port> so Hermes' built-in
// DNS-rebinding check accepts them. Nothing else is changed or stored.
const http = require('node:http')
const net = require('node:net')

const UPSTREAM = process.env.UPSTREAM_HOST || 'host.docker.internal'
const LISTEN = process.env.LISTEN_HOST || '0.0.0.0'
const PORTS = (process.env.BRIDGE_PORTS || '8642,9119').split(',').map(Number)

function start(port) {
  const hostHeader = `127.0.0.1:${port}`

  const server = http.createServer((req, res) => {
    const upstream = http.request(
      { host: UPSTREAM, port, method: req.method, path: req.url, headers: { ...req.headers, host: hostHeader } },
      (up) => {
        res.writeHead(up.statusCode, up.headers)
        up.pipe(res)
      },
    )
    upstream.on('error', (e) => {
      if (!res.headersSent) res.writeHead(502)
      res.end('bridge error: ' + e.message)
    })
    req.pipe(upstream)
  })

  // WebSocket / upgrade requests: rewrite the Host header, then pass bytes through.
  server.on('upgrade', (req, socket, head) => {
    const up = net.connect(port, UPSTREAM, () => {
      let raw = `${req.method} ${req.url} HTTP/1.1\r\n`
      for (const [k, v] of Object.entries({ ...req.headers, host: hostHeader })) raw += `${k}: ${v}\r\n`
      up.write(raw + '\r\n')
      if (head.length) up.write(head)
      socket.pipe(up).pipe(socket)
    })
    up.on('error', () => socket.destroy())
    socket.on('error', () => up.destroy())
  })

  server.listen(port, LISTEN, () => console.log(`bridge :${port} -> ${UPSTREAM}:${port}`))
}

PORTS.forEach(start)
