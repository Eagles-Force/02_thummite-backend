import 'dotenv/config'
import db, { query, closePool } from '../src/config/db.js'

const requiredTables = [
  'users', 'admin_profiles', 'otps', 'password_reset_tokens', 'supplier_profiles',
  'buyer_profiles', 'categories', 'product_listings', 'inquiries', 'inquiry_messages',
  'notifications', 'reviews', 'saved_suppliers', 'saved_listings', 'subscription_plans',
  'subscription_transactions'
]

try {
  const { rows } = await query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `)
  const existing = new Set(rows.map((row) => row.table_name))
  const missing = requiredTables.filter((table) => !existing.has(table))
  if (missing.length) throw new Error(`Missing tables: ${missing.join(', ')}. Run database/migrations/001_initial_schema.sql in Neon.`)

  await query('SELECT 1')
  const categories = await db.from('categories').select('id, name, slug').limit(1)
  if (categories.error) throw categories.error
  const listings = await db.from('product_listings').select('id, name, supplier_profiles ( id, business_name )').limit(1)
  if (listings.error) throw listings.error
  const inquiries = await db.from('inquiries').select('id, buyer_profiles ( id, username, business_name, users!buyer_profiles_user_id_fkey ( email ) )').limit(1)
  if (inquiries.error) throw inquiries.error

  console.log('Database verification passed.')
  console.log(`Verified ${requiredTables.length} required tables, Neon connectivity, and relational query support.`)
} catch (error) {
  console.error(`Database verification failed: ${error.message}`)
  process.exitCode = 1
} finally {
  await closePool().catch(() => {})
}
