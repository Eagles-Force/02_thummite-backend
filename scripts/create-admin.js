import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { getClient, closePool } from '../src/config/db.js'

const { ADMIN_EMAIL, ADMIN_PHONE, ADMIN_PASSWORD, ADMIN_FULL_NAME } = process.env

try {
  if (!ADMIN_EMAIL || !ADMIN_PHONE || !ADMIN_PASSWORD || !ADMIN_FULL_NAME) {
    throw new Error('Set ADMIN_EMAIL, ADMIN_PHONE, ADMIN_PASSWORD and ADMIN_FULL_NAME before running this script.')
  }
  if (ADMIN_PASSWORD.length < 12) throw new Error('ADMIN_PASSWORD must contain at least 12 characters.')
  const email = ADMIN_EMAIL.trim().toLowerCase()
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12)
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const existing = await client.query('SELECT id FROM users WHERE email = $1 OR phone = $2 FOR UPDATE', [email, ADMIN_PHONE.trim()])
    if (existing.rowCount) throw new Error('An account with this email or phone already exists. Use a different admin identity.')
    const inserted = await client.query(
      `INSERT INTO users (email, phone, password_hash, role, is_email_verified, is_phone_verified)
       VALUES ($1, $2, $3, 'admin', TRUE, TRUE) RETURNING id`,
      [email, ADMIN_PHONE.trim(), passwordHash]
    )
    await client.query(
      `INSERT INTO admin_profiles (user_id, full_name, role_title, is_super_admin)
       VALUES ($1, $2, 'Platform Administrator', TRUE)`,
      [inserted.rows[0].id, ADMIN_FULL_NAME.trim()]
    )
    await client.query('COMMIT')
    console.log(`Administrator created: ${email}`)
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally { client.release() }
} catch (error) {
  console.error(`Admin provisioning failed: ${error.message}`)
  process.exitCode = 1
} finally {
  await closePool().catch(() => {})
}
