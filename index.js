const express = require('express');
const app = express();
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const createAuthRouter = require('./auth.route');
const { requireAuth } = require('./authMiddleware');

const port = process.env.PORT || 3000;
const Stripe = require('stripe');
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

if (!stripeSecretKey) {
  console.warn('[config] STRIPE_SECRET_KEY is not set; payment endpoints will be unavailable');
}

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.7xap9dx.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    const db = client.db("smart_decor");
    const room_details_collection = db.collection("room_details");
    const booking_payment_collection = db.collection("booking_payment");
    const users_collection = db.collection("users");
    const favourites_collection = db.collection("favourites");
    const chat_collection = db.collection("conversations");

    const verifyAdmin = async (req, res, next) => {
      try {
        const email = req.user?.email;
        if (!email) return res.status(401).send({ message: 'Unauthorized' });
        const user = await users_collection.findOne({ email });
        if (!user || user.role !== 'admin') {
          return res.status(403).send({ message: 'Forbidden: Admin only' });
        }
        next();
      } catch (err) {
        console.error('[admin] role check failed');
        return res.status(500).send({ message: 'Internal Server Error' });
      }
    };

    app.use('/auth', createAuthRouter({ usersCollection: users_collection }));

    // --- User Management ---

    // ১. রেজিস্ট্রেশন
    app.post('/users', async (req, res) => {
      try {
        const { name, email, password, photoUrl, role } = req.body
        if (!email) return res.status(400).send({ message: 'Email is required' })

        const existing = await users_collection.findOne({ email })
        if (existing) return res.status(409).send({ message: 'User already exists' })

        const newUser = {
          name: name || '',
          email,
          password: password || null,
          photoURL: photoUrl || '',
          role: role || 'user',
          createdAt: new Date()
        }

        const result = await users_collection.insertOne(newUser)
        const secret = process.env.JWT_SECRET
        if (secret) {
          const token = jwt.sign(
            { id: result.insertedId.toString(), email, role: newUser.role },
            secret,
            { expiresIn: '7d' }
          )
          return res.status(201).send({ success: true, token, user: newUser })
        }
        res.status(201).send({ success: true, user: newUser })
      } catch (err) {
        console.error('[users] register error:', err.message)
        res.status(500).send({ message: 'Internal Server Error' })
      }
    })

    // ২. প্রোফাইল আপডেট
    app.patch('/users/update/:email', requireAuth, async (req, res) => {
      const email = req.params.email;
      const { name, photoURL } = req.body;
      if (req.user.email !== email) {
        return res.status(403).send({ message: 'Forbidden' });
      }
      try {
        const result = await users_collection.updateOne(
          { email },
          { $set: { name, photoURL } }
        );
        if (result.matchedCount === 0) {
          return res.status(404).send({ success: false, message: 'User not found' });
        }
        res.send({ success: true, message: 'Profile updated successfully' });
      } catch (error) {
        res.status(500).send({ success: false, message: 'Failed to update profile' });
      }
    });

    // ৩. নিজের info
    app.get('/users/me', requireAuth, async (req, res) => {
      try {
        const email = req.user?.email;
        const user = await users_collection.findOne(
          { email },
          { projection: { name: 1, email: 1, role: 1, photoURL: 1 } }
        );
        if (!user) return res.status(404).send({ message: 'User not found' });
        res.status(200).send(user);
      } catch (err) {
        res.status(500).send({ message: 'Internal Server Error' });
      }
    });

    // ✅ ৪. Chat এর জন্য contact list — decorator ও admin
    app.get('/users/contacts', requireAuth, async (req, res) => {
      try {
        const role = req.user?.role

        let query = {}
        if (role === 'user') {
          // user শুধু decorator ও admin দেখবে
          query = {
            role: { $in: ['decorator', 'admin'] },
            email: { $ne: req.user.email }
          }
        } else if (role === 'decorator') {
          // decorator সব user ও admin দেখবে
          query = {
            role: { $in: ['user', 'admin'] },
            email: { $ne: req.user.email }
          }
        } else if (role === 'admin') {
          // admin সবাইকে দেখবে
          query = {
            email: { $ne: req.user.email }
          }
        }

        const contacts = await users_collection.find(
          query,
          { projection: { name: 1, email: 1, role: 1, photoURL: 1 } }
        ).toArray()

        res.send(contacts)
      } catch (err) {
        console.error('[contacts] error:', err.message)
        res.status(500).send({ message: 'Internal Server Error' })
      }
    })

    // --- Chat API ---

    // Start conversation
    app.post('/chat/conversations/start', requireAuth, async (req, res) => {
      try {
        const { decoratorId, decoratorName, participantId, participantName } = req.body;
        const userEmail = req.user.email;
        const targetEmail = participantId || decoratorId
        const targetName = participantName || decoratorName || 'Participant'

        if (!targetEmail) {
          return res.status(400).send({ message: 'participantId is required' })
        }

        const existing = await chat_collection.findOne({
          participants: { $all: [userEmail, targetEmail] }
        });
        if (existing) return res.send(existing);

        const newConversation = {
          participants: [userEmail, targetEmail],
          user: { email: userEmail, name: req.user.name || '' },
          decorator: { email: targetEmail, name: targetName },
          messages: [],
          lastUpdated: new Date(),
          unreadCount: 0
        };

        const result = await chat_collection.insertOne(newConversation);
        res.status(201).send({ ...newConversation, _id: result.insertedId });
      } catch (err) {
        console.error('[chat] start error:', err.message)
        res.status(500).send({ message: 'Internal Server Error' })
      }
    });

    // Get all conversations
    app.get('/chat/conversations', requireAuth, async (req, res) => {
      try {
        const email = req.user.email;
        const result = await chat_collection.find({
          participants: email
        }).sort({ lastUpdated: -1 }).toArray();
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: 'Internal Server Error' })
      }
    });

    // Get single conversation
    app.get('/chat/conversations/:id', requireAuth, async (req, res) => {
      try {
        const { id } = req.params
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: 'Invalid conversation ID' })
        }
        const conversation = await chat_collection.findOne({
          _id: new ObjectId(id),
          participants: req.user.email
        })
        if (!conversation) {
          return res.status(404).send({ message: 'Conversation not found' })
        }
        res.send(conversation)
      } catch (err) {
        res.status(500).send({ message: 'Internal Server Error' })
      }
    });

    // Send message
    app.post('/chat/conversations/:id/messages', requireAuth, async (req, res) => {
      try {
        const id = req.params.id;
        const { text } = req.body;
        const senderEmail = req.user.email;

        if (!ObjectId.isValid(id)) return res.status(400).send({ message: 'Invalid ID' });
        if (!text?.trim()) return res.status(400).send({ message: 'Message text is required' });

        const newMessage = {
          sender: senderEmail,
          text: text.trim(),
          timestamp: new Date(),
          read: false
        };

        const result = await chat_collection.updateOne(
          { _id: new ObjectId(id), participants: senderEmail },
          {
            $push: { messages: newMessage },
            $set: { lastUpdated: new Date() },
            $inc: { unreadCount: 1 }
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: 'Conversation not found' })
        }
        res.send(newMessage);
      } catch (err) {
        res.status(500).send({ message: 'Internal Server Error' })
      }
    });

    // Mark as read
    app.put('/chat/conversations/:id/read', requireAuth, async (req, res) => {
      try {
        const { id } = req.params
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: 'Invalid conversation ID' })
        }
        await chat_collection.updateOne(
          { _id: new ObjectId(id), participants: req.user.email },
          { $set: { unreadCount: 0, 'messages.$[].read': true } }
        )
        res.send({ success: true })
      } catch (err) {
        res.status(500).send({ message: 'Internal Server Error' })
      }
    });

    // Delete conversation
    app.delete('/chat/conversations/:id', requireAuth, async (req, res) => {
      try {
        const { id } = req.params
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: 'Invalid conversation ID' })
        }
        const result = await chat_collection.deleteOne({
          _id: new ObjectId(id),
          participants: req.user.email
        })
        if (result.deletedCount === 0) {
          return res.status(404).send({ message: 'Conversation not found' })
        }
        res.send({ success: true, message: 'Conversation deleted' })
      } catch (err) {
        res.status(500).send({ message: 'Internal Server Error' })
      }
    });

    // --- Favourites ---
    app.post('/favourites', requireAuth, async (req, res) => {
      try {
        const userEmail = req.user.email;
        const { itemId, itemType, name, price, image } = req.body;
        if (!itemId) return res.status(400).send({ message: 'itemId is required' });

        const existing = await favourites_collection.findOne({ itemId, userEmail });
        if (existing) return res.status(409).send({ message: 'Already in favourites' });

        const favouriteData = {
          itemId, itemType: itemType || 'service',
          name, price, image, userEmail, addedAt: new Date()
        };
        const result = await favourites_collection.insertOne(favouriteData);
        res.status(201).send({ ...favouriteData, _id: result.insertedId });
      } catch (err) {
        res.status(500).send({ message: 'Failed to add favourite' });
      }
    });

    app.get('/favourites', requireAuth, async (req, res) => {
      const result = await favourites_collection.find({ userEmail: req.user.email }).toArray();
      res.send(result);
    });

    app.delete('/favourites/:id', requireAuth, async (req, res) => {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) return res.status(400).send({ message: 'Invalid id' });
      const result = await favourites_collection.deleteOne({
        _id: new ObjectId(id), userEmail: req.user.email
      });
      res.send(result);
    });

    // --- Rooms ---
    app.get('/rooms', async (req, res) => {
      const result = await room_details_collection.find().toArray();
      res.send(result);
    });

    app.get('/rooms/:id', async (req, res) => {
      try {
        const { id } = req.params
        if (!ObjectId.isValid(id)) return res.status(400).send({ message: 'Invalid room ID' })
        const room = await room_details_collection.findOne({ _id: new ObjectId(id) })
        if (!room) return res.status(404).send({ message: 'Room not found' })
        res.send(room)
      } catch (err) {
        res.status(500).send({ message: 'Internal Server Error' })
      }
    })

    // --- Bookings ---
    app.get('/user/bookings', requireAuth, async (req, res) => {
      try {
        const email = req.user.email
        const bookings = await booking_payment_collection.find({
          $or: [
            { 'user.email': email },
            { userEmail: email },
            { email: email },
          ]
        }).toArray();
        res.send(bookings);
      } catch (err) {
        res.status(500).send({ message: 'Internal Server Error' })
      }
    });

    app.post('/bookings', requireAuth, async (req, res) => {
      try {
        const bookingData = {
          ...req.body,
          user: { ...(req.body.user || {}), email: req.user.email },
          userId: req.user.id ? new ObjectId(req.user.id) : null,
          paymentStatus: 'pending',
          status: 'Pending',
          createdAt: new Date()
        };
        const result = await booking_payment_collection.insertOne(bookingData);
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Booking failed" });
      }
    });

    // --- Payment ---
    app.post('/create-payment-intent', requireAuth, async (req, res) => {
      try {
        if (!stripe) return res.status(503).send({ message: 'Payment service unavailable' })
        const { amount, bookingId } = req.body
        if (!amount || !bookingId) {
          return res.status(400).send({ message: 'Amount and bookingId are required' })
        }
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(amount),
          currency: 'usd',
          metadata: { bookingId: bookingId.toString(), userEmail: req.user.email }
        })
        res.send({ clientSecret: paymentIntent.client_secret })
      } catch (err) {
        console.error('[payment] intent error:', err.message)
        res.status(500).send({ message: 'Failed to create payment intent' })
      }
    })

    app.patch('/payments/confirm/:bookingId', requireAuth, async (req, res) => {
      try {
        const { bookingId } = req.params
        const { transactionId } = req.body
        if (!ObjectId.isValid(bookingId)) {
          return res.status(400).send({ message: 'Invalid booking ID' })
        }
        const result = await booking_payment_collection.updateOne(
          { _id: new ObjectId(bookingId) },
          { $set: { status: 'Confirmed', paymentStatus: 'paid', transactionId, paidAt: new Date() } }
        )
        if (result.matchedCount === 0) {
          return res.status(404).send({ message: 'Booking not found' })
        }
        res.send({ success: true, message: 'Payment confirmed' })
      } catch (err) {
        console.error('[payment] confirm error:', err.message)
        res.status(500).send({ message: 'Failed to confirm payment' })
      }
    })

    console.log("Connected to MongoDB!");
  } catch (error) {
    console.error("MongoDB Connection Error:", error);
  }
}

run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('StyleDecor Server is Running');
});

app.use((err, req, res, next) => {
  console.error('[error]:', err.message);
  res.status(500).send({ message: 'Internal Server Error' });
});

if (!process.env.VERCEL) {
  app.listen(port, () => console.log(`Server listening on port ${port}`));
}

module.exports = app;