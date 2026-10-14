import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const children = []
let stopping = false

function stop(exitCode) {
  if (stopping) return
  stopping = true
  process.exitCode = exitCode
  for (const child of children) {
    if (child.exitCode === null) child.kill()
  }
}

function start(label, entryPoint) {
  const child = spawn(process.execPath, [entryPoint], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
  })
  children.push(child)
  child.once('error', (error) => {
    console.error(`Could not start ${label}: ${error.message}`)
    stop(1)
  })
  child.once('exit', (code, signal) => {
    if (!stopping) {
      const exitCode = code ?? (signal ? 1 : 0)
      console.error(`${label} stopped${signal ? ` (${signal})` : ` with code ${exitCode}`}.`)
      stop(exitCode)
    }
  })
}

process.once('SIGINT', () => stop(130))
process.once('SIGTERM', () => stop(143))

start('API server', path.join(projectRoot, 'server', 'index.js'))
start('Vite frontend', path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'))
