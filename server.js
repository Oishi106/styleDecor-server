const express = require('express')
const app = express()
const cors=require('cors')
const { MongoClient, ServerApiVersion } = require('mongodb');
const { ObjectId } = require('mongodb')
const port = 3000
require('dotenv').config()
const Stripe = require('stripe')
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder')

//middleware
app.use(cors())
app.use(express.json())


const uri = "mongodb+srv://styledecor_admin:JNtKA3Mll0ko1MPR@cluster0.7xap9dx.mongodb.net/?appName=Cluster0";



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
    await client.connect();

    const db=client.db("smart_decor")
    const room_details_collection=db.collection("room_details")
    const booking_payment_collection=db.collection("booking_payment")
    const users_collection=db.collection("users")

   //room details api
     app.get('/rooms',async(req,res)=>{
      const query={}
      const cursor=room_details_collection.find(query)
      const result=await cursor.toArray()
      res.send(result)
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

app.get('/users', async (req, res) => {
  const users = await users_collection.find().toArray()
  res.send(users)
})


    //paymentbooking api

    app.post('/create-payment-intent', async (req, res) => {
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
app.post('/bookings', async (req, res) => {
  const {
    name,
    email,
    roomId,
    roomName,
    price
  } = req.body

  if (!email || !roomId || !roomName || !price) {
    return res.status(400).send({
      message: 'Missing required booking information'
    })
  }

  const bookingData = {
    user: { name, email },
    roomId,
    roomName,
    price,

    paymentStatus: 'pending',
    transactionId: null,

    createdAt: new Date(),
    paidAt: null
  }

  const result = await booking_payment_collection.insertOne(bookingData)
  res.send(result)
})
//confirmed
app.patch('/payments/confirm/:id', async (req, res) => {
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
    await client.db("admin").command({ ping: 1 });
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

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})