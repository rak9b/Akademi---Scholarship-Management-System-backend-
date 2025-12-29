require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const Stripe = require('stripe');

const app = express();
const port = process.env.PORT || 5000;

/**
 * --- ELITE INFRASTRUCTURE CONFIGURATION ---
 * Optimized for Vercel Serverless & MongoDB Atlas
 */

// Initialize Stripe gracefully (Support both common naming conventions)
const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SC_KEY;
const stripe = stripeKey ? Stripe(stripeKey) : null;

const REGISTRY_STATS = {
    version: "2.5.0-Signature",
    status: "Central Registry Operational",
    origin: "Akademi Institutional Systems"
};

// Elite Institutional Fallback Data
const SIGNATURE_FALLBACK_DATA = [
    {
        _id: new ObjectId(),
        scholarshipName: "Global Excellence Doctorate Fellowship",
        universityName: "Oxford Academy of Sciences",
        universityLogo: "https://i.ibb.co.com/89L3hGZ/oxford-logo.png",
        universityImage: "https://images.unsplash.com/photo-1541339907198-e08756defe73?auto=format&fit=crop&q=80&w=1600",
        scholarshipCategory: "Doctoral",
        universityLocation: { city: "Oxford", country: "United Kingdom" },
        applicationDeadline: "2024-09-15",
        subjectCategory: "Engineering",
        scholarshipDescription: "An elite fellowship designed for researchers pushing the boundaries of sustainable energy. Includes full tuition and research stipend.",
        stipend: "$45,000",
        serviceCharge: 150,
        applicationFees: 85,
        rating: 4.9
    },
    {
        _id: new ObjectId(),
        scholarshipName: "Dean's Signature MBA Scholarship",
        universityName: "Stanford Graduate Registry",
        universityLogo: "https://i.ibb.co.com/mD1Mkw1/stanford-logo.png",
        universityImage: "https://images.unsplash.com/photo-1576402187878-974f70c890a5?auto=format&fit=crop&q=80&w=1600",
        scholarshipCategory: "Masters",
        universityLocation: { city: "Palo Alto", country: "USA" },
        applicationDeadline: "2024-11-20",
        subjectCategory: "Business",
        scholarshipDescription: "The most prestigious business grant awarded to students demonstrating exceptional leadership in digital frontiers.",
        stipend: "$60,000",
        serviceCharge: 200,
        applicationFees: 120,
        rating: 5.0
    },
    {
        _id: new ObjectId(),
        scholarshipName: "Pacific Rim Innovation Prize",
        universityName: "University of Tokyo",
        universityLogo: "https://i.ibb.co.com/X2fM6bS/utokyo-logo.png",
        universityImage: "https://images.unsplash.com/photo-1525920980995-f8a382bf42c5?auto=format&fit=crop&q=80&w=1600",
        scholarshipCategory: "Research",
        universityLocation: { city: "Tokyo", country: "Japan" },
        applicationDeadline: "2024-10-10",
        subjectCategory: "Medicine",
        scholarshipDescription: "Awarded to groundbreaking research in bio-medical engineering and robotic surgery.",
        stipend: "¥5,000,000",
        serviceCharge: 110,
        applicationFees: 60,
        rating: 4.8
    }
];

// Middleware
app.use(cors({
    origin: [
        "http://localhost:5173",
        "https://akademi-scholarship-management-syst-one.vercel.app",
        "https://scholarship-management-sys.vercel.app",
        "https://akademi-scholarship-management-syst-beta.vercel.app",
        "https://akademi---scholarship-management-system-frontend-.vercel.app"
    ],
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "PUT", "OPTIONS"]
}));
app.use(express.json());

// --- MONGODB CACHED CONNECTION POOL ---
let cachedDb = null;
let cachedClient = null;

// Global Collections
let scholarshipsCollection, userCollection, reviewCollection, applicationCollection;

async function getRegistryConnection() {
    if (cachedDb) return cachedDb;

    // Support for both Full URI and Component-based credentials
    let uri = process.env.MONGODB_URI;

    if (!uri) {
        if (!process.env.DB_USER || !process.env.DB_PASS) {
            throw new Error("AUTHENTICATION_FAILURE: DB_USER or DB_PASS is missing in environment variables.");
        }
        const user = encodeURIComponent(process.env.DB_USER);
        const pass = encodeURIComponent(process.env.DB_PASS);
        uri = `mongodb+srv://${user}:${pass}@cluster0sholarship.vv8m6fy.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0sholarship`;
    }

    if (!cachedClient) {
        cachedClient = new MongoClient(uri, {
            serverApi: {
                version: ServerApiVersion.v1,
                strict: true,
                deprecationErrors: true,
            },
            connectTimeoutMS: 20000,
            socketTimeoutMS: 45000,
            maxPoolSize: 10, // Optimized for serverless concurrency
        });
        await cachedClient.connect();
    }

    const db = cachedClient.db("Akademi");

    // Initialize Collection Pointers
    scholarshipsCollection = db.collection("Scholarships");
    userCollection = db.collection('Users');
    reviewCollection = db.collection('Reviews');
    applicationCollection = db.collection('Application');

    cachedDb = db;
    return db;
}

// Global Intelligence Guard (DB Connection Middleware)
app.use(async (req, res, next) => {
    // Skip protection for public health checks
    if (["/health", "/diag", "/ping"].includes(req.path)) return next();

    try {
        await getRegistryConnection();
        next();
    } catch (err) {
        console.error("Institutional Registry Synchronization Failure:", err.message);
        res.status(503).json({
            success: false,
            error: "Institutional Registry Syncing... Connection Rejected.",
            diagnostic: {
                code: "AUTHENTICATION_FAILED",
                message: "Verify DB_USER, DB_PASS, and MongoDB Atlas IP Whitelist (0.0.0.0/0).",
                technical_details: err.message
            }
        });
    }
});

// --- CORE SYSTEM ROUTES ---

app.get('/health', (req, res) => res.json({ ...REGISTRY_STATS, registry_online: !!cachedDb }));

app.get('/diag', (req, res) => {
    res.json({
        institutional_service: "Akademi Scholarship Registry",
        environment_sync: !!process.env.MONGODB_URI || (!!process.env.DB_USER && !!process.env.DB_PASS),
        auth_status: !!cachedDb ? "Authorized" : "Awaiting Credentials",
        registry_uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// User Intelligence Management
app.post('/create-user', async (req, res) => {
    try {
        const existing = await userCollection.findOne({ userEmail: req.body.email });
        if (existing) return res.json({ message: 'Registry Identified: Previously Established', insertedId: null });
        const result = await userCollection.insertOne({
            userName: req.body.displayName,
            userEmail: req.body.email,
            role: 'user',
            registered_at: new Date()
        });
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/users/:email', async (req, res) => {
    try {
        const user = await userCollection.findOne({ userEmail: req.params.email });
        res.json(user || { message: "No Institutional Record Found" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/all-users', async (req, res) => {
    try {
        const users = await userCollection.find().toArray();
        res.json(users);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/update-role/:id', async (req, res) => {
    try {
        const result = await userCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { role: req.query.role } }
        );
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Scholarship Dossier Directory (Main Hero Grid)
app.get('/', async (req, res) => {
    try {
        if (!scholarshipsCollection) return res.json(SIGNATURE_FALLBACK_DATA);
        const result = await scholarshipsCollection.find()
            .sort({ applicationFees: 1, _id: -1 })
            .limit(6)
            .toArray();
        res.json(result.length > 0 ? result : SIGNATURE_FALLBACK_DATA);
    } catch (err) { res.json(SIGNATURE_FALLBACK_DATA); }
});

app.get('/all-data', async (req, res) => {
    try {
        if (!scholarshipsCollection) return res.json(SIGNATURE_FALLBACK_DATA);
        const result = await scholarshipsCollection.find().toArray();
        res.json(result.length > 0 ? result : SIGNATURE_FALLBACK_DATA);
    } catch (err) { res.json(SIGNATURE_FALLBACK_DATA); }
});

app.get('/scholarship/:id', async (req, res) => {
    try {
        const id = new ObjectId(req.params.id);
        const result = await scholarshipsCollection.aggregate([
            { $match: { _id: id } },
            { $lookup: { from: 'Reviews', localField: '_id', foreignField: 'postId', as: 'reviews' } }
        ]).toArray();
        res.json(result[0] || { error: "Dossier Not Found" });
    } catch { res.status(400).json({ error: "Invalid Institutional ID Format" }); }
});

app.post('/add-scholarship', async (req, res) => {
    try {
        const result = await scholarshipsCollection.insertOne({
            ...req.body,
            created_at: new Date()
        });
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Financial Intelligence Processing
app.post('/create-payment-intent', async (req, res) => {
    if (!stripe) return res.status(500).json({ error: "Financial Clearance Gateway Offline" });
    const { price } = req.body;
    try {
        const intent = await stripe.paymentIntents.create({
            amount: Math.round(price * 100),
            currency: 'usd',
            metadata: { system: "Akademi Scholarship Registry" }
        });
        res.json({ clientSecret: intent.client_secret });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

// --- VERCEL EXPORT PROTOCOL ---

if (require.main === module) {
    // Local Academic Environment
    getRegistryConnection().then(() => {
        app.listen(port, () => {
            console.log(`🏛️  Academic Administrative Server Active: Port ${port}`);
        });
    }).catch(err => {
        console.error("CRITICAL BRAIN FAILURE:", err.message);
        process.exit(1);
    });
}

// Primary Module Export for Serverless Adaptation
module.exports = app;