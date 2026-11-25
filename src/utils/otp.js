import { randomInt } from 'node:crypto'
import db from '../config/db.js'

export const generateOTP = () => String(randomInt(100000, 1000000))

export const storeOTP = async (userId, otp) => {
  const { error: deleteError } = await db.from('otps').delete().eq('user_id', userId)
  if (deleteError) throw deleteError
  const { error } = await db.from('otps').insert({
    user_id: userId,
    otp,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  })
  if (error) throw new Error('Unable to store email verification code.')
}

export const verifyOTP = async (userId, otp) => {
  const { data, error } = await db.from('otps').select('id, otp, expires_at').eq('user_id', userId).single()
  if (error || !data || data.otp !== String(otp)) return { valid: false, message: 'Invalid OTP.' }
  if (Date.now() > new Date(data.expires_at).getTime()) {
    await db.from('otps').delete().eq('user_id', userId)
    return { valid: false, message: 'OTP has expired. Please request a new one.' }
  }
  await db.from('otps').delete().eq('user_id', userId)
  return { valid: true }
}
