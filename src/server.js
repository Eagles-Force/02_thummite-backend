import 'dotenv/config'
import app from './app.js'
import { closePool } from './config/db.js'

const PORT = Number(process.env.PORT || 10000)
const server = app.listen(PORT, () => {
  console.log(`Thummite API listening on port ${PORT} (${process.env.NODE_ENV || 'development'})`)
})

const shutdown = (signal) => {
  console.log(`${signal} received. Closing HTTP server and database pool.`)
  server.close(async () => {
    await closePool().catch((error) => console.error('Database pool shutdown error:', error))
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 10000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
