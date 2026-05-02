const express = require('express')
const { requireAuth } = require('./authMiddleware')
const jwt = require('jsonwebtoken')
const { ObjectId } = require('mongodb')

function createAuthRouter({ usersCollection }) {
  if (!usersCollection) {
    throw new Error('createAuthRouter requires usersCollection')
  }

  const router = express.Router()

  // GET /auth/me
  router.get('/me', requireAuth, async (req, res) => {
    try {
      const id = req.user?.id
      if (!id || typeof id !== 'string' || !ObjectId.isValid(id)) {
        console.error('[auth/me] invalid token payload (missing/invalid id)')
        return res.status(401).send({ message: 'Unauthorized' })
      }

      const user = await usersCollection.findOne(
        { _id: new ObjectId(id) },
        { projection: { name: 1, email: 1, role: 1 } }
      )

      if (!user) {
        console.error('[auth/me] user not found for id:', id)
        return res.status(404).send({ message: 'User not found' })
      }

      return res.status(200).send(user)
    } catch (err) {
      console.error('[auth/me] server error', {
        name: err?.name,
        code: err?.code,
        message: err?.message
      })
      return res.status(500).send({ message: 'Internal Server Error' })
    }
  })

  // POST /auth/jwt  body: { email }
  router.post('/jwt', async (req, res) => {
    try {
      const { email } = req.body || {}

      if (!email || typeof email !== 'string') {
        return res.status(400).send({ message: 'Email is required' })
      }

      const secret = process.env.JWT_SECRET
      if (!secret) {
        console.warn('[auth/jwt] JWT_SECRET is not set')
        return res.status(500).send({ message: 'Server auth not configured' })
      }

      const user = await usersCollection.findOne({ email })
      if (!user) {
        return res.status(401).send({ message: 'User not found' })
      }

      const id = user?._id?.toString?.()
      if (!id || !ObjectId.isValid(id)) {
        console.error('[auth/jwt] user has invalid _id')
        return res.status(500).send({ message: 'Internal Server Error' })
      }

      const token = jwt.sign(
        {
          id: user._id.toString(),
          email: user.email,
          role: user.role
        },
        secret,
        { expiresIn: '7d' }
      )

      return res.send({ token })
    } catch (err) {
      console.error('[auth/jwt] server error')
      return res.status(500).send({ message: 'Internal Server Error' })
    }
  })

  return router 
}

module.exports = createAuthRouter    
