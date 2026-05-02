const jwt = require('jsonwebtoken')
const { ObjectId } = require('mongodb')

function getBearerToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization
  if (!header || typeof header !== 'string') return null

  const trimmed = header.trim()
  if (!trimmed) return null

  const parts = trimmed.split(/\s+/)
  if (parts.length !== 2) return null

  const [scheme, token] = parts
  if (!scheme || scheme.toLowerCase() !== 'bearer') return null
  if (!token) return null

  return token
}

function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers?.authorization || req.headers?.Authorization
    if (!authHeader || typeof authHeader !== 'string') {
      console.warn('[auth] missing Authorization header')
      return res.status(401).json({ message: 'No authorization header' })
    }

    if (!authHeader.startsWith('Bearer ')) {
      console.warn('[auth] invalid auth format')
      return res.status(401).json({ message: 'Invalid auth format' })
    }

    const token = authHeader.split(' ')[1]
    if (!token) {
      console.warn('[auth] missing token')
      return res.status(401).json({ message: 'Unauthorized: missing token' })
    }

    const secret = process.env.JWT_SECRET
    if (!secret) {
      console.warn('[auth] JWT_SECRET is not set')
      // Keep this as 401 so auth-related calls never show as 500.
      return res.status(401).json({ message: 'Unauthorized: server auth not configured' })
    }

    let decoded
    try {
      decoded = jwt.verify(token, secret)
    } catch (err) {
      const name = err?.name
      if (name === 'TokenExpiredError') {
        console.error('JWT VERIFY ERROR:', err?.message)
        return res.status(401).json({ message: 'Token invalid or expired' })
      }

      console.error('JWT VERIFY ERROR:', err?.message)
      return res.status(401).json({ message: 'Token invalid or expired' })
    }

    if (!decoded || typeof decoded !== 'object') {
      console.warn('[auth] decoded payload missing/invalid')
      return res.status(401).json({ message: 'Invalid token payload' })
    }

    const email = decoded.email
    if (email && typeof email !== 'string') {
      console.warn('[auth] token payload email is invalid')
      return res.status(401).json({ message: 'Invalid token payload' })
    }

    const id = decoded.id
    if (!id || typeof id !== 'string' || !ObjectId.isValid(id)) {
      console.warn('[auth] token payload missing/invalid id')
      return res.status(401).json({ message: 'Invalid token payload' })
    }

    // Attach only safe, expected fields.
    req.user = {
      id,
      email: typeof email === 'string' ? email : undefined,
      role: typeof decoded.role === 'string' ? decoded.role : undefined
    }

    return next()
  } catch (err) {
    // Never 500 for auth problems; treat as unauthorized.
    console.warn('[auth] unexpected auth error')
    return res.status(401).json({ message: 'Token invalid or expired' })
  }
}

// Export verifyToken name for compatibility with your preferred naming.
const verifyToken = requireAuth

module.exports = { requireAuth, verifyToken, getBearerToken }
