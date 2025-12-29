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
    origin: ["http://localhost:5173", "https://akademi-scholarship-management-syst-one.vercel.app", "https://scholarship-management-sys.vercel.app", "https://akademi-scholarship-management-syst-beta.vercel.app"],
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "PUT", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());

// --- MONGODB CONNECTION POOLING ---
let cachedClient = null;
let cachedDb = null;
let scholarshipsCollection, userCollection, reviewCollection, applicationCollection;

async function getDatabase() {
    if (cachedDb) return cachedDb;

    let uri = process.env.MONGODB_URI;

    // Auto-construct if URI is not provided
    if (!uri) {
        if (!process.env.DB_USER || !process.env.DB_PASS) {
            throw new Error("Missing Credentials: DB_USER or DB_PASS not found in environment.");
        }
        const user = encodeURIComponent(process.env.DB_USER);
        const pass = encodeURIComponent(process.env.DB_PASS);
        uri = `mongodb+srv://${user}:${pass}@cluster0.wwjbp.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
    }

    // Serverless Optimized Client
    if (!cachedClient) {
        cachedClient = new MongoClient(uri, {
            serverApi: {
                version: ServerApiVersion.v1,
                strict: true,
                deprecationErrors: true,
            },
            connectTimeoutMS: 20000,
            socketTimeoutMS: 45000,
            maxPoolSize: 10,
        });
        await cachedClient.connect();
    }

    const db = cachedClient.db("Akademi");

    // Warm up collections
    scholarshipsCollection = db.collection("Scholarships");
    userCollection = db.collection('Users');
    reviewCollection = db.collection('Reviews');
    applicationCollection = db.collection('Application');

    cachedDb = db;
    return db;
}

// Diagnostics Route (Safe)
app.get('/diag', async (req, res) => {
    res.json({
        service: 'Institutional Registry',
        environment: process.env.NODE_ENV || 'development',
        hasUri: !!process.env.MONGODB_URI,
        hasUser: !!process.env.DB_USER,
        hasPass: !!process.env.DB_PASS,
        dbConnected: !!cachedDb,
        timestamp: new Date().toISOString()
    });
});

// Global DB Middleware with verbose error logging for the USER
app.use(async (req, res, next) => {
    if (req.path === '/diag' || req.path === '/health') return next();
    try {
        await getDatabase();
        next();
    } catch (err) {
        console.error("Registry Sync Failure:", err.message);
        res.status(503).json({
            error: "Institutional Registry Syncing... Please reload.",
            diagnostic: err.message.includes("IP") ? "IP Whitelist Error: Check MongoDB Atlas Settings." : "Authentication Error: Check DB_USER/DB_PASS."
        });
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
        if (!['admin', 'moderator'].includes(user?.role)) return res.status(403).json({ error: 'Registry Clearance Denied' });
        next();
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// --- ROUTES ---

app.get('/health', (req, res) => res.json({ status: 'Operational', registry: !!cachedDb }));

// User Management
app.post('/create-user', async (req, res) => {
    try {
        const existing = await userCollection.findOne({ userEmail: req.body.email });
        if (existing) return res.json({ message: 'Registry Exists', insertedId: null });
        res.json(await userCollection.insertOne({ userName: req.body.displayName, userEmail: req.body.email, role: 'user' }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/users/:email', async (req, res) => {
    try {
        res.json(await userCollection.findOne({ userEmail: req.params.email }) || {});
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/all-users', verifyAdmin, async (req, res) => {
    try {
        res.json(await userCollection.find().toArray());
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/update-role/:id', verifyAdmin, async (req, res) => {
    try {
        res.json(await userCollection.updateOne({ _id: new ObjectId(req.params.id) }, { $set: { role: req.query.role } }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Scholarship Directory
app.get('/', async (req, res) => {
    try {
        res.json(await scholarshipsCollection.find().sort({ applicationFees: 1, _id: -1 }).limit(6).toArray());
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/all-data', async (req, res) => {
    try {
        res.json(await scholarshipsCollection.find().toArray());
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/scholarship/:id', async (req, res) => {
    try {
        const id = new ObjectId(req.params.id);
        const result = await scholarshipsCollection.aggregate([
            { $match: { _id: id } },
            { $lookup: { from: 'Reviews', localField: '_id', foreignField: 'postId', as: 'reviews' } }
        ]).toArray();
        res.json(result[0] || {});
    } catch { res.status(400).json({ error: "Institutional ID Invalid" }); }
});

app.post('/add-scholarship', verifyStaff, async (req, res) => {
    try {
        res.json(await scholarshipsCollection.insertOne(req.body));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Payments
app.post('/create-payment-intent', async (req, res) => {
    if (!stripe) return res.status(500).json({ error: "Financial Portal Offline" });
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
    }).catch(err => console.error("Initial Registry Failure:", err.message));
}

module.exports = app;