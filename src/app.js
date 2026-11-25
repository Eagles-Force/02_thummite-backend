import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import { query } from './config/db.js'
import authRoutes from './routes/auth.routes.js'
import categoryRoutes from './routes/category.routes.js'
import supplierRoutes from './routes/supplier.routes.js'
import listingRoutes from './routes/listing.routes.js'
import inquiryRoutes from './routes/inquiry.routes.js'
import buyerRoutes from './routes/buyer.routes.js'
import adminRoutes from './routes/admin.routes.js'
import reviewRoutes from './routes/review.routes.js'

const app = express()
app.set('trust proxy', 1)
app.use(helmet())

const allowedOrigins = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  ...(process.env.FRONTEND_URL || '').split(',').map((origin) => origin.trim()).filter(Boolean),
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean)
])

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true)
    return callback(new Error('Origin is not allowed by CORS.'))
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400
}))
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'))
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true, limit: '1mb' }))

app.get('/health', async (req, res) => {
  try {
    await query('SELECT 1')
    res.status(200).json({ success: true, message: 'Thummite API and database are healthy.', timestamp: new Date().toISOString() })
  } catch (error) {
    console.error('Health check database failure:', error.message)
    res.status(503).json({ success: false, message: 'Database connection unavailable.' })
  }
})

app.use('/api/v1/auth', authRoutes)
app.use('/api/v1/categories', categoryRoutes)
app.use('/api/v1/suppliers', supplierRoutes)
app.use('/api/v1/listings', listingRoutes)
app.use('/api/v1/inquiries', inquiryRoutes)
app.use('/api/v1/buyers', buyerRoutes)
app.use('/api/v1/admin', adminRoutes)
app.use('/api/v1/reviews', reviewRoutes)

app.use((req, res) => res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` }))
app.use((error, req, res, next) => {
  console.error('Unhandled API error:', error)
  if (res.headersSent) return next(error)
  res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Internal server error' })
})

export default app
