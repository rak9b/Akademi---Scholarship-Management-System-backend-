require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const Stripe = require('stripe');

const app = express();
const port = process.env.PORT || 5000;

// Initialize Stripe gracefully
const stripe = process.env.STRIPE_SC_KEY ? Stripe(process.env.STRIPE_SC_KEY) : null;

// Middleware
app.use(cors({
    origin: ["http://localhost:5173", "https://akademi-scholarship-management-syst-one.vercel.app", "https://scholarship-management-sys.vercel.app"],
    credentials: true
}));
app.use(express.json());

// --- MONGODB CONNECTION POOLING ---
let cachedDb = null;
let scholarshipsCollection, userCollection, reviewCollection, applicationCollection;

async function getDatabase() {
    if (cachedDb) return cachedDb;

    // Robust URI Management: Support for single string or user/pass parts
    let uri = process.env.MONGODB_URI;

    if (!uri) {
        const user = encodeURIComponent(process.env.DB_USER);
        const pass = encodeURIComponent(process.env.DB_PASS);
        uri = `mongodb+srv://${user}:${pass}@cluster0.wwjbp.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
    }

    const client = new MongoClient(uri, {
        serverApi: {
            version: ServerApiVersion.v1,
            strict: true,
            deprecationErrors: true,
        },
        connectTimeoutMS: 15000,
        socketTimeoutMS: 45000,
    });

    await client.connect();
    const db = client.db("Akademi");

    // Warm up collections
    scholarshipsCollection = db.collection("Scholarships");
    userCollection = db.collection('Users');
    reviewCollection = db.collection('Reviews');
    applicationCollection = db.collection('Application');

    cachedDb = db;
    return db;
}

// Global DB Middleware
app.use(async (req, res, next) => {
    try {
        await getDatabase();
        next();
    } catch (err) {
        console.error("Database Connection Middleware Error:", err.message);
        res.status(503).json({ error: "Institutional Registry Syncing... Please reload." });
    }
});

// --- AUTH MIDDLEWARE ---
const verifyAdmin = async (req, res, next) => {
    try {
        const user = await userCollection.findOne({ userEmail: req.query.email });
        if (user?.role !== 'admin') return res.status(403).json({ error: 'Administrative Clearance Denied' });
        next();
    } catch (e) { res.status(500).json({ error: e.message }); }
};

const verifyStaff = async (req, res, next) => {
    try {
        const user = await userCollection.findOne({ userEmail: req.query.email });
        if (!['admin', 'moderator'].includes(user?.role)) return res.status(403).json({ error: 'Staff Clearance Denied' });
        next();
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// --- ROUTES ---

app.get('/health', (req, res) => res.json({ status: 'Operational', db: !!cachedDb }));

// User Management
app.post('/create-user', async (req, res) => {
    const existing = await userCollection.findOne({ userEmail: req.body.email });
    if (existing) return res.json({ message: 'Exists', insertedId: null });
    res.json(await userCollection.insertOne({ userName: req.body.displayName, userEmail: req.body.email, role: 'user' }));
});

app.get('/users/:email', async (req, res) => res.json(await userCollection.findOne({ userEmail: req.params.email }) || {}));

app.get('/all-users', verifyAdmin, async (req, res) => res.json(await userCollection.find().toArray()));

app.patch('/update-role/:id', verifyAdmin, async (req, res) => {
    res.json(await userCollection.updateOne({ _id: new ObjectId(req.params.id) }, { $set: { role: req.query.role } }));
});

// Scholarship Directory
app.get('/', async (req, res) => {
    res.json(await scholarshipsCollection.find().sort({ applicationFees: 1, _id: -1 }).limit(6).toArray());
});

app.get('/all-data', async (req, res) => res.json(await scholarshipsCollection.find().toArray()));

app.get('/scholarship/:id', async (req, res) => {
    try {
        const id = new ObjectId(req.params.id);
        const result = await scholarshipsCollection.aggregate([
            { $match: { _id: id } },
            { $lookup: { from: 'Reviews', localField: '_id', foreignField: 'postId', as: 'reviews' } }
        ]).toArray();
        res.json(result[0] || {});
    } catch { res.status(400).json({ error: "Invalid ID" }); }
});

app.post('/add-scholarship', verifyStaff, async (req, res) => res.json(await scholarshipsCollection.insertOne(req.body)));

// Payments
app.post('/create-payment-intent', async (req, res) => {
    if (!stripe) return res.status(500).json({ error: "Payment Gateway Offline" });
    const { price } = req.body;
    try {
        const intent = await stripe.paymentIntents.create({ amount: Math.round(price * 100), currency: 'usd' });
        res.json({ clientSecret: intent.client_secret });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

// --- VERCEL EXPORT ---
if (require.main === module) {
    getDatabase().then(() => {
        app.listen(port, () => console.log(`🚀 Academic Server: ${port}`));
    });
}

module.exports = app;