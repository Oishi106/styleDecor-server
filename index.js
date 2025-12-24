const express = require('express')
const app = express()
const cors = require('cors')
const { MongoClient, ServerApiVersion } = require('mongodb');
const { ObjectId } = require('mongodb')
const jwt = require('jsonwebtoken')
const port = 3000
require('dotenv').config()
const Stripe = require('stripe')
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

//middleware
app.use(cors())
app.use(express.json())
//jwt verification middleware
const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).send({ message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).send({ message: "Forbidden" });
    }

    req.decoded = decoded; // { email, role }
    next();
  });
};



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.7xap9dx.mongodb.net/?appName=Cluster0`;



// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const db = client.db("smart_decor")
    const room_details_collection = db.collection("room_details")
    const booking_payment_collection = db.collection("booking_payment")
    const users_collection = db.collection("users")


    //admin verification middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.user.email

      const user = await users_collection.findOne({ email })

      if (!user || user.role !== 'admin') {
        return res.status(403).send({ message: 'Forbidden: Admin only' })
      }

      next()
    }
    //decorator middleware
    const verifyDecorator = async (req, res, next) => {
      const email = req.user.email

      const user = await users_collection.findOne({ email })

      if (!user || user.role !== 'decorator') {
        return res.status(403).send({ message: 'Forbidden: Decorator only' })
      }

      next()
    }





    //for frontend to get logged in user info

    app.get('/auth/me', verifyJWT, async (req, res) => {
      const user = await users_collection.findOne(
        { email: req.user.email },
        { projection: { name: 1, email: 1, role: 1 } }
      )

      res.send(user)
    })

    // Alternative endpoint for /users/me
    app.get('/users/me', verifyJWT, async (req, res) => {
      const user = await users_collection.findOne(
        { email: req.user.email },
        { projection: { name: 1, email: 1, role: 1 } }
      )

      res.send(user)
    })


    // issue jwt
    app.post('/auth/jwt', async (req, res) => {
      const { email } = req.body

      if (!email) {
        return res.status(400).send({ message: 'Email is required' })
      }

      const user = await users_collection.findOne({ email })

      if (!user) {
        return res.status(401).send({ message: 'User not found' })
      }

      const token = jwt.sign(
        { email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN }
      )

      res.send({ token })
    })
    //for admin all bookings
    app.get(
      '/admin/bookings',
      verifyJWT,
      verifyAdmin,
      async (req, res) => {

        const { paymentStatus, jobStatus } = req.query

        const query = {}

        if (paymentStatus) {
          query.paymentStatus = paymentStatus
        }

        if (jobStatus) {
          query.jobStatus = jobStatus
        }

        const bookings = await booking_payment_collection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray()

        res.send(bookings)
      }
    )
    //single bookings for admin
    app.get(
      '/admin/bookings/:id',
      verifyJWT,
      verifyAdmin,
      async (req, res) => {

        const id = req.params.id

        const booking = await booking_payment_collection.findOne({
          _id: new ObjectId(id)
        })

        if (!booking) {
          return res.status(404).send({ message: 'Booking not found' })
        }

        res.send(booking)
      }
    )
    //user dashboard api
    app.get(
      '/user/bookings',
      verifyJWT,
      async (req, res) => {

        const userEmail = req.user.email

        const bookings = await booking_payment_collection
          .find({ 'user.email': userEmail })
          .sort({ createdAt: -1 })
          .toArray()

        res.send(bookings)
      }
    )
    //single booking for user
    app.get(
      '/user/bookings/:id',
      verifyJWT,
      async (req, res) => {

        const bookingId = req.params.id
        const userEmail = req.user.email

        const booking = await booking_payment_collection.findOne({
          _id: new ObjectId(bookingId),
          'user.email': userEmail
        })

        if (!booking) {
          return res.status(404).send({ message: 'Booking not found' })
        }

        res.send(booking)
      }
    )



    //room details api
    app.get('/rooms', async (req, res) => {
      const query = {}
      const cursor = room_details_collection.find(query)
      const result = await cursor.toArray()
      res.send(result)
    })

    app.get('/rooms/:id', async (req, res) => {
      const id = req.params.id

      //  Prevent crash on invalid ObjectId
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: 'Invalid room id' })
      }

      const room = await room_details_collection.findOne({
        _id: new ObjectId(id)
      })

      if (!room) {
        return res.status(404).send({ message: 'Room not found' })
      }

      res.send(room)
    })

    //users api
    app.post('/users', async (req, res) => {
      const { name, email } = req.body

      if (!email) {
        return res.status(400).send({ message: 'Email is required' })
      }

      const existingUser = await users_collection.findOne({ email })

      if (existingUser) {
        return res.send({ message: 'User already exists' })
      }

      const user = {
        name,
        email,
        role: 'user',
        createdAt: new Date()
      }

      const result = await users_collection.insertOne(user)
      res.send(result)
    })

    app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
      const users = await users_collection.find().toArray()
      res.send(users)
    })

    // Admin: add/promote a decorator
    // Expects body: { email: string, name?: string, ... }
    app.post('/admin/decorators', verifyJWT, verifyAdmin, async (req, res) => {
      const { email, name, ...rest } = req.body || {}

      if (!email) {
        return res.status(400).send({ message: 'Email is required' })
      }

      const existing = await users_collection.findOne({ email })

      // Avoid accidentally changing an admin account
      if (existing?.role === 'admin') {
        return res.status(400).send({ message: 'Cannot change admin role' })
      }

      if (!existing) {
        const decoratorUser = {
          name: name || null,
          email,
          role: 'decorator',
          createdAt: new Date(),
          decoratorProfile: { ...rest },
          updatedAt: new Date()
        }

        const result = await users_collection.insertOne(decoratorUser)
        return res.send({ ok: true, insertedId: result.insertedId })
      }

      if (existing.role === 'decorator') {
        return res.status(409).send({ message: 'User is already a decorator' })
      }

      const updateDoc = {
        role: 'decorator',
        updatedAt: new Date()
      }

      if (name) updateDoc.name = name
      if (Object.keys(rest).length > 0) updateDoc.decoratorProfile = { ...rest }

      const result = await users_collection.updateOne(
        { email },
        {
          $set: updateDoc,
          $setOnInsert: { createdAt: new Date() }
        },
        { upsert: true }
      )

      res.send({ ok: true, modifiedCount: result.modifiedCount, upsertedId: result.upsertedId })
    })






    // decoretor apply api

    app.post(
      '/decorator/apply',
      verifyJWT,
      async (req, res) => {

        const email = req.user.email
        const applicationData = req.body

        // prevent duplicate application
        const existing = await users_collection.findOne({ email })

        if (existing?.role === 'decorator') {
          return res.status(400).send({ message: 'Already a decorator' })
        }

        const result = await users_collection.updateOne(
          { email },
          {
            $set: {
              decoratorApplication: {
                ...applicationData,
                status: 'pending',
                appliedAt: new Date()
              }
            }
          }
        )

        res.send({ message: 'Decorator application submitted' })
      }
    )

    //decorator api



    app.get("/decorator/jobs", verifyJWT, async (req, res) => {
      try {
        const decoratorEmail = req.query.decoratorEmail;

        if (!decoratorEmail) {
          return res.status(400).send({
            message: "Decorator email is required"
          });
        }

        const jobs = await booking_payment_collection.find({
          assignedDecoratorEmail: decoratorEmail
        }).toArray();

        res.send(jobs);
      } catch (error) {
        res.status(500).send({
          message: "Failed to fetch decorator jobs"
        });
      }
    });





    //

    app.patch(
      '/decorator/job-status/:id',
      verifyJWT,
      verifyDecorator,
      async (req, res) => {

        const bookingId = req.params.id
        const { status } = req.body
        const decoratorEmail = req.user.email

        const allowedStatuses = ['assigned', 'in-progress', 'completed']

        if (!allowedStatuses.includes(status)) {
          return res.status(400).send({ message: 'Invalid job status' })
        }

        const booking = await booking_payment_collection.findOne({
          _id: new ObjectId(bookingId)
        })

        if (!booking) {
          return res.status(404).send({ message: 'Booking not found' })
        }

        if (booking.decorator?.email !== decoratorEmail) {
          return res.status(403).send({
            message: 'Not your assigned job'
          })
        }

        const validFlow = {
          assigned: ['in-progress'],
          'in-progress': ['completed'],
          completed: []
        }

        if (!validFlow[booking.jobStatus]?.includes(status)) {
          return res.status(400).send({
            message: `Invalid status change from ${booking.jobStatus} to ${status}`
          })
        }

        const updateData = {
          jobStatus: status
        }

        if (status === 'in-progress') {
          updateData.startedAt = new Date()
        }

        if (status === 'completed') {
          updateData.completedAt = new Date()
        }

        const result = await booking_payment_collection.updateOne(
          { _id: new ObjectId(bookingId) },
          { $set: updateData }
        )

        res.send(result)
      }
    )



    //assign decorator to booking only through admin
    app.patch(
      '/bookings/assign-decorator/:id',
      verifyJWT,
      verifyAdmin,
      async (req, res) => {

        const bookingId = req.params.id
        const { decoratorEmail } = req.body

        if (!decoratorEmail) {
          return res.status(400).send({ message: 'Decorator email required' })
        }

        const booking = await booking_payment_collection.findOne({
          _id: new ObjectId(bookingId)
        })

        if (!booking) {
          return res.status(404).send({ message: 'Booking not found' })
        }

        if (booking.paymentStatus !== 'paid') {
          return res.status(400).send({
            message: 'Payment not completed'
          })
        }

        const decorator = await users_collection.findOne({
          email: decoratorEmail,
          role: 'decorator'
        })

        if (!decorator) {
          return res.status(404).send({
            message: 'Decorator not found'
          })
        }

        const result = await booking_payment_collection.updateOne(
          { _id: new ObjectId(bookingId) },
          {
            $set: {
              decorator: {
                email: decorator.email,
                name: decorator.name
              },
              jobStatus: 'assigned',
              assignedAt: new Date()
            }
          }
        )

        res.send(result)
      }
    )




    //api for decorator dashboard
    app.get(
      '/decorator/jobs',
      verifyJWT,
      verifyDecorator,
      async (req, res) => {

        const decoratorEmail = req.user.email
        const status = req.query.status

        const query = { 'decorator.email': decoratorEmail }

        if (status) {
          query.jobStatus = status
        }

        const jobs = await booking_payment_collection.find(query).toArray()
        res.send(jobs)
      }
    )
    //job status update by decorator
    app.patch(
      '/decorator/job-status/:id',
      verifyJWT,
      verifyDecorator,
      async (req, res) => {

        const bookingId = req.params.id
        const { status } = req.body
        const decoratorEmail = req.user.email

        const allowedStatuses = ['assigned', 'in-progress', 'completed']

        if (!allowedStatuses.includes(status)) {
          return res.status(400).send({ message: 'Invalid job status' })
        }

        // Find booking
        const booking = await booking_payment_collection.findOne({
          _id: new ObjectId(bookingId)
        })

        if (!booking) {
          return res.status(404).send({ message: 'Booking not found' })
        }

        //  Ensure booking is assigned to this decorator
        if (booking.decorator?.email !== decoratorEmail) {
          return res.status(403).send({
            message: 'Forbidden: Not your assigned job'
          })
        }

        // Validate status flow
        const currentStatus = booking.jobStatus

        const validFlow = {
          assigned: ['in-progress'],
          in_progress: ['completed'],
          completed: []
        }

        if (!validFlow[currentStatus]?.includes(status)) {
          return res.status(400).send({
            message: `Invalid status transition from ${currentStatus} to ${status}`
          })
        }

        // Update job status
        const updateData = {
          jobStatus: status
        }

        if (status === 'in-progress') {
          updateData.startedAt = new Date()
        }

        if (status === 'completed') {
          updateData.completedAt = new Date()
        }

        const result = await booking_payment_collection.updateOne(
          { _id: new ObjectId(bookingId) },
          { $set: updateData }
        )

        res.send(result)
      }
    )




    //paymentbooking api

    app.post('/create-payment-intent', verifyJWT, async (req, res) => {
      const { amount } = req.body

      if (!amount || amount < 1) {
        return res.status(400).send({
          message: 'Amount must be at least $1'
        })
      }

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount * 100, // cents
        currency: 'usd',
        payment_method_types: ['card']
      })

      res.send({
        clientSecret: paymentIntent.client_secret
      })
    })
    //// create booking (payment pending)
    app.post('/bookings', verifyJWT, async (req, res) => {
      const emailFromToken = req.user.email
      const { name, roomId, roomName, price } = req.body

      if (!emailFromToken || !roomId || !roomName || !price) {
        return res.status(400).send({
          message: 'Missing required booking information'
        })
      }

      const bookingData = {
        user: {
          name,
          email: emailFromToken   //  FIXED
        },
        roomId,
        roomName,
        price,

        paymentStatus: 'pending',
        transactionId: null,

        jobStatus: 'pending',     //  ADD THIS
        decorator: null,

        createdAt: new Date(),
        paidAt: null
      }

      const result = await booking_payment_collection.insertOne(bookingData)
      res.send(result)
    })





    app.patch('/users/role/:id', verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id
      const { role } = req.body

      const result = await users_collection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role } }
      )

      res.send(result)
    })
    //confirmed
    app.patch('/payments/confirm/:id', verifyJWT, async (req, res) => {
      const { id } = req.params
      const { transactionId } = req.body

      const existing = await booking_payment_collection.findOne({
        _id: new ObjectId(id)
      })

      //  Prevent double payment
      if (existing?.paymentStatus === 'paid') {
        return res.status(400).send({ message: 'Payment already completed' })
      }

      const result = await booking_payment_collection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            paymentStatus: 'paid',
            transactionId,
            paidAt: new Date()
          }
        }
      )

      res.send(result)
    })

    //api for booking and pending
    app.get('/bookings/:email', async (req, res) => {
      const email = req.params.email
      const result = await booking_payment_collection
        .find({ 'user.email': email })
        .toArray()

      res.send(result)
    })


    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('hey bhai')
})

// Vercel runs this as a Serverless Function; do not call listen() there.
if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
  })
}

module.exports = app
