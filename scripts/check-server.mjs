import WebSocket from 'ws'

const url = process.argv[2] ?? process.env.SIGGE_WS_URL ?? 'ws://127.0.0.1:8787'
const timeoutMs = Number(process.env.SIGGE_CHECK_TIMEOUT_MS ?? 5000)

const timeout = setTimeout(() => {
  console.error(`Timed out waiting for ${url}`)
  process.exit(1)
}, timeoutMs)

const ws = new WebSocket(url)

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'hello',
    alias: 'Healthcheck',
    color: '#f0d08b',
  }))
})

ws.on('message', (raw) => {
  const message = JSON.parse(raw.toString())
  if (message.type === 'welcome') {
    clearTimeout(timeout)
    ws.close()
    console.log(`OK ${url}`)
  }
})

ws.on('error', (error) => {
  clearTimeout(timeout)
  console.error(error.message)
  process.exit(1)
})
