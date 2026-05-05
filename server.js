// Local dev entrypoint (optional).
// On Vercel, index.js is used as the serverless function entry.
process.env.VERCEL = process.env.VERCEL || '1'

const app = require('./index')
              
const port = process.env.PORT || 3000
app.listen(port, () => {
  console.log(`Server listening on port ${port}`)
})
