import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { UserStore } from './storage/user-store.js'
import { WorkspacePool } from './workspaces/runtime.js'
import { createServer } from './http/server.js'
import { createMcpAuth } from './auth/mcp-auth.js'
import { verifyTeambitionIdentity } from '../connectors/teambition/verify.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const store = new UserStore(process.env.WORKHUB_DATA_DIR || path.join(root, 'data/users'))
const pool = new WorkspacePool(store)
const auth = createMcpAuth({ verify: async (input, options) => {
  const verified = await verifyTeambitionIdentity(input, options)
  await store.profile(verified.owner)
  return verified
} })
const server = createServer(pool, path.join(root, 'dist'), auth)
server.listen(Number(process.env.PORT || 3080), process.env.HOST || '127.0.0.1', () => console.log(`WorkHub: http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 3080}`))
let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  server.close()
  await pool.stop()
  server.closeAllConnections()
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
