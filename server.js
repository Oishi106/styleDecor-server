const express = require('express')
const app = express()
const cors = require('cors')
const { MongoClient, ServerApiVersion } = require('mongodb');
const port = 3000

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
        // Connect the client to the server    (optional starting in v4.7)
        await client.connect();

        const db = client.db("smart_decor")
        const room_details_collection = db.collection("room_details")
        const booking_payment_collection = db.collection("booking_payment")
        const users_collection = db.collection("users")

        //room details api
        app.get('/rooms', async (req, res) => {
            const query = {}
            const cursor = room_details_collection.find(query)
            const result = await cursor.toArray()
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