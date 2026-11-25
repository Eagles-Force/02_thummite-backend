const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL = process.env.SENDER_EMAIL
const FROM_NAME = process.env.FROM_NAME || 'Thummite'

const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]))

const baseTemplate = (content) => `
<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body{font-family:Arial,sans-serif;background:#f4f6fa;margin:0;padding:0}.container{max-width:600px;margin:40px auto;background:#fff;border-radius:10px;overflow:hidden}.header{background:#142b4a;padding:30px;text-align:center}.header h1{color:#fff;margin:0;font-size:24px;letter-spacing:2px}.header p{color:#b9c8da;margin:6px 0 0;font-size:12px;letter-spacing:1px}.body{padding:38px 30px}.body h2{color:#142b4a;margin-top:0}.body p{color:#4d5968;line-height:1.65}.otp-box{background:#f1f6fc;border:2px dashed #2374bd;border-radius:8px;text-align:center;padding:20px;margin:26px 0}.otp-code{font-size:34px;font-weight:bold;color:#142b4a;letter-spacing:8px}.otp-note{color:#66758a;font-size:13px;margin-top:8px}.button{display:inline-block;background:#1769aa;color:#fff!important;text-decoration:none;padding:13px 22px;border-radius:6px;font-weight:bold}.footer{background:#f8fafc;padding:20px 30px;text-align:center}.footer p{color:#8793a3;font-size:12px;margin:4px 0}
</style></head><body><div class="container"><div class="header"><h1>THUMMITE</h1><p>Perfect and Truth</p></div><div class="body">${content}</div><div class="footer"><p>© ${new Date().getFullYear()} Thummite. All rights reserved.</p><p>If you did not request this email, you can safely ignore it.</p></div></div></body></html>`

const sendEmail = async (to, subject, html) => {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured.')
  if (!FROM_EMAIL) throw new Error('SENDER_EMAIL is not configured.')
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `${FROM_NAME} <${FROM_EMAIL}>`, to: [to], subject, html })
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    console.error('Resend delivery error:', { status: response.status, message: result.message || result.name })
    throw new Error('Email delivery failed. Please try again later.')
  }
  return result
}

export const sendOTPEmail = async (email, name, otp) => {
  const content = `<h2>Verify your email address</h2><p>Hello ${escapeHtml(name)},</p><p>Use this one-time password to verify your Thummite account.</p><div class="otp-box"><div class="otp-code">${escapeHtml(otp)}</div><div class="otp-note">This code expires in 10 minutes.</div></div><p>If you did not create this account, ignore this message.</p>`
  return sendEmail(email, 'Verify your email — Thummite', baseTemplate(content))
}

export const sendWelcomeEmail = async (email, name, role) => {
  const roleMessage = role === 'supplier'
    ? 'Complete your supplier profile, publish your products and start receiving sourcing inquiries.'
    : 'Search raw materials, compare suppliers, save options and manage your sourcing inquiries in one place.'
  const content = `<h2>Welcome to Thummite!</h2><p>Hello ${escapeHtml(name)},</p><p>Your email has been verified successfully.</p><p>${roleMessage}</p><p>— The Thummite Team</p>`
  return sendEmail(email, 'Welcome to Thummite — Perfect and Truth', baseTemplate(content))
}

export const sendPasswordResetEmail = async (email, name, resetUrl) => {
  const content = `<h2>Reset your password</h2><p>Hello ${escapeHtml(name)},</p><p>We received a request to reset your Thummite password. Use the button below to choose a new password. This link expires in 30 minutes and can only be used once.</p><p style="text-align:center;margin:28px 0"><a class="button" href="${escapeHtml(resetUrl)}">Reset password</a></p><p>If you did not request a password reset, ignore this email. Your password will remain unchanged.</p>`
  return sendEmail(email, 'Reset your Thummite password', baseTemplate(content))
}
