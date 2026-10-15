import { spawn, spawnSync } from 'node:child_process'

const build = spawnSync('npm', ['run', 'build:host'], { stdio: 'inherit' })
if (build.status !== 0) process.exit(build.status || 1)
const children = [spawn(process.execPath, ['--watch', 'server/index.js'], { stdio: 'inherit' }), spawn('npm', ['exec', 'vite'], { stdio: 'inherit' })]
let closing = false
function stop(code = 0) {
  if (closing) return
  closing = true
  for (const child of children) child.kill('SIGTERM')
  process.exitCode = code
}
for (const child of children) child.on('exit', (code) => stop(code || 0))
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
