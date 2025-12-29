require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const Stripe = require('stripe');

const app = express();
const port = process.env.PORT || 5000;
const stripe = Stripe(process.env.STRIPE_SC_KEY);

// Middleware
app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173'
}));
app.use(express.json());

// MongoDB Connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.wwjbp.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

let scholarshipsCollection, userCollection, reviewCollection, applicationCollection;

async function bootstrap() {
    try {
        await client.connect();
        const database = client.db("Akademi");
        scholarshipsCollection = database.collection("Scholarships");
        userCollection = database.collection('Users');
        reviewCollection = database.collection('Reviews');
        applicationCollection = database.collection('Application');

        console.log("✅ Successfully connected to MongoDB Atlas");
    } catch (err) {
        console.error("❌ MongoDB Connection Failure. Running with degraded functionality.", err.message);
    } finally {
        // Database connection attempt finished
    }
}

// DB Check Middleware
const dbGuard = (req, res, next) => {
    if (!scholarshipsCollection) {
        return res.status(503).send({ message: 'Database initializing. Please retry in seconds.' });
    }
    next();
};

// Auth Middlewares
const verifyAdmin = async (req, res, next) => {
    if (!userCollection) return res.status(503).send({ message: 'DB Unavailable' });
    try {
        const user = await userCollection.findOne({ userEmail: req.query.email });
        if (user?.role !== 'admin') return res.status(403).send({ message: 'Unauthorized' });
        next();
    } catch (e) {
        res.status(500).send({ error: e.message });
    }
};

const verifyStaff = async (req, res, next) => {
    if (!userCollection) return res.status(503).send({ message: 'DB Unavailable' });
    try {
        const user = await userCollection.findOne({ userEmail: req.query.email });
        if (!['admin', 'moderator'].includes(user?.role)) return res.status(403).send({ message: 'Unauthorized' });
        next();
    } catch (e) {
        res.status(500).send({ error: e.message });
    }
};

// --- ROUTES ---

app.get('/health', (req, res) => res.send({ status: 'OK', db: !!scholarshipsCollection }));

// User Management
app.post('/create-user', dbGuard, async (req, res) => {
    const existing = await userCollection.findOne({ userEmail: req.body.email });
    if (existing) return res.send({ message: 'Exists', insertedId: null });
    const result = await userCollection.insertOne({ userName: req.body.displayName, userEmail: req.body.email, role: 'user' });
    res.send(result);
});

app.get('/users/:email', dbGuard, async (req, res) => {
    res.send(await userCollection.findOne({ userEmail: req.params.email }));
});

app.get('/all-users', dbGuard, verifyAdmin, async (req, res) => {
    res.send(await userCollection.find().toArray());
});

app.patch('/update-role/:id', dbGuard, verifyAdmin, async (req, res) => {
    const result = await userCollection.updateOne({ _id: new ObjectId(req.params.id) }, { $set: { role: req.query.role } });
    res.send(result);
});

// Scholarship Core
app.get('/', dbGuard, async (req, res) => {
    const result = await scholarshipsCollection.find().sort({ applicationFees: 1, _id: -1 }).limit(6).toArray();
    res.send(result);
});

app.get('/all-data', dbGuard, async (req, res) => {
    res.send(await scholarshipsCollection.find().toArray());
});

const safeObjectId = (id) => {
    try {
        return new ObjectId(id);
    } catch {
        return null;
    }
};

// ...
app.get('/scholarship/:id', dbGuard, async (req, res) => {
    const id = safeObjectId(req.params.id);
    if (!id) return res.status(400).send({ message: 'Invalid ID' });
    const result = await scholarshipsCollection.aggregate([
        { $match: { _id: id } },
        { $lookup: { from: 'Reviews', localField: '_id', foreignField: 'postId', as: 'reviews' } }
    ]).toArray();
    res.send(result[0] || {});
});

app.post('/add-scholarship', dbGuard, verifyStaff, async (req, res) => {
    res.send(await scholarshipsCollection.insertOne(req.body));
});

// Payments
app.post('/create-payment-intent', async (req, res) => {
    const { price } = req.body;
    try {
        const intent = await stripe.paymentIntents.create({ amount: Math.round(price * 100), currency: 'usd', payment_method_types: ['card'] });
        res.send({ clientSecret: intent.client_secret });
    } catch (e) {
        res.status(400).send({ error: e.message });
    }
});

// Export the Express API checking for Vercel environment
// Export the Express API checking for Vercel environment
if (process.env.NODE_ENV !== 'production') {
    bootstrap().then(() => {
        app.listen(port, () => {
            console.log(`🚀 Elite Server active on port ${port}`);
        });
    });
} else {
    // For Vercel, we need to export the app but also ensure DB connects
    bootstrap().catch(console.error);
}

module.exports = app;