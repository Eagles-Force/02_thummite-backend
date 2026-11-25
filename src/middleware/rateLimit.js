const buckets = new Map()

// Per-instance protection for sensitive public endpoints. For multi-instance deployments,
// move this limiter to a shared store such as Redis.
export const rateLimit = ({ windowMs = 60_000, max = 10, message = 'Too many requests. Please try again later.' } = {}) => (req, res, next) => {
  const key = req.ip || req.socket.remoteAddress || 'unknown'
  const now = Date.now()
  let bucket = buckets.get(key)
  if (!bucket || now - bucket.startedAt >= windowMs) {
    bucket = { startedAt: now, count: 0 }
    buckets.set(key, bucket)
  }
  bucket.count += 1
  if (buckets.size > 10000) {
    for (const [storedKey, storedBucket] of buckets) {
      if (now - storedBucket.startedAt >= windowMs) buckets.delete(storedKey)
      if (buckets.size <= 8000) break
    }
  }
  res.setHeader('RateLimit-Limit', String(max))
  res.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.count)))
  if (bucket.count > max) return res.status(429).json({ success: false, message })
  next()
}
