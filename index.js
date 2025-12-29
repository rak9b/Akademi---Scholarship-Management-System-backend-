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
    origin: ["http://localhost:5173", "https://akademi-scholarship-management-syst-one.vercel.app", "https://scholarship-management-sys.vercel.app"]
}));
app.use(express.json());

// MongoDB Connection Configuration
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.wwjbp.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Connection Cache
let cachedClient = null;
let cachedDb = null;

// Global Collections
let scholarshipsCollection, userCollection, reviewCollection, applicationCollection;

async function connectToDatabase() {
    if (cachedClient && cachedDb) {
        return { client: cachedClient, db: cachedDb };
    }

    try {
        const client = new MongoClient(uri, {
            serverApi: {
                version: ServerApiVersion.v1,
                strict: true,
                deprecationErrors: true,
            },
            connectTimeoutMS: 10000, // 10s timeout
            socketTimeoutMS: 45000,
        });

        await client.connect();
        const db = client.db("Akademi");

        // Initialize Collections
        scholarshipsCollection = db.collection("Scholarships");
        userCollection = db.collection('Users');
        reviewCollection = db.collection('Reviews');
        applicationCollection = db.collection('Application');

        cachedClient = client;
        cachedDb = db;

        console.log("✅ MongoDB Connection Established");
        return { client, db };
    } catch (error) {
        console.error("❌ MongoDB Connection Error:", error.message);
        throw error; // Let the caller handle it or let it crash to trigger Vercel retry
    }
}

// DB Readiness Guard
const dbGuard = (req, res, next) => {
    if (!scholarshipsCollection) {
        return res.status(503).json({
            success: false,
            message: 'Central Intelligence Database is establishing connection. Please stand by.'
        });
    }
    next();
};

// --- AUTH MIDDLEWARE ---
const verifyAdmin = async (req, res, next) => {
    if (!userCollection) return res.status(503).json({ message: 'Institutional Record Offline' });
    try {
        const user = await userCollection.findOne({ userEmail: req.query.email });
        if (user?.role !== 'admin') return res.status(403).json({ message: 'Access Denied: Administrative Clearance Required' });
        next();
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

const verifyStaff = async (req, res, next) => {
    if (!userCollection) return res.status(503).json({ message: 'Institutional Record Offline' });
    try {
        const user = await userCollection.findOne({ userEmail: req.query.email });
        if (!['admin', 'moderator'].includes(user?.role)) return res.status(403).json({ message: 'Access Denied: Registry Clearance Required' });
        next();
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// --- ROUTES ---

app.get('/health', (req, res) => {
    res.json({
        status: 'Operational',
        database: isConnected() ? 'Online' : 'Connecting',
        timestamp: new Date().toISOString()
    });
});

function isConnected() {
    return !!scholarshipsCollection;
}

// User Management
app.post('/create-user', dbGuard, async (req, res) => {
    try {
        const existing = await userCollection.findOne({ userEmail: req.body.email });
        if (existing) return res.json({ message: 'Registry Established', insertedId: null });
        const result = await userCollection.insertOne({
            userName: req.body.displayName,
            userEmail: req.body.email,
            role: 'user',
            created_at: new Date()
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/users/:email', dbGuard, async (req, res) => {
    try {
        const user = await userCollection.findOne({ userEmail: req.params.email });
        res.json(user || {});
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/all-users', dbGuard, verifyAdmin, async (req, res) => {
    try {
        const users = await userCollection.find().toArray();
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/update-role/:id', dbGuard, verifyAdmin, async (req, res) => {
    try {
        const result = await userCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { role: req.query.role } }
        );
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Scholarship Directory
app.get('/', dbGuard, async (req, res) => {
    try {
        const result = await scholarshipsCollection.find()
            .sort({ applicationFees: 1, _id: -1 })
            .limit(6)
            .toArray();
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/all-data', dbGuard, async (req, res) => {
    try {
        const result = await scholarshipsCollection.find().toArray();
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/scholarship/:id', dbGuard, async (req, res) => {
    try {
        const id = new ObjectId(req.params.id);
        const result = await scholarshipsCollection.aggregate([
            { $match: { _id: id } },
            { $lookup: { from: 'Reviews', localField: '_id', foreignField: 'postId', as: 'reviews' } }
        ]).toArray();
        res.json(result[0] || {});
    } catch (err) {
        res.status(500).json({ error: "Institutional ID Invalid or Record Missing" });
    }
});

app.post('/add-scholarship', dbGuard, verifyStaff, async (req, res) => {
    try {
        const result = await scholarshipsCollection.insertOne(req.body);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Financial Portal
app.post('/create-payment-intent', async (req, res) => {
    const { price } = req.body;
    try {
        const intent = await stripe.paymentIntents.create({
            amount: Math.round(price * 100),
            currency: 'usd',
            payment_method_types: ['card']
        });
        res.json({ clientSecret: intent.client_secret });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// --- VERCEL EXECUTION HANDLER ---

if (require.main === module) {
    // Local Development Mode
    connectToDatabase().then(() => {
        app.listen(port, () => {
            console.log(`🏛️  Institutional Server active on port ${port}`);
        });
    }).catch(err => {
        console.error("Critical Failure:", err);
        process.exit(1);
    });
} else {
    // Serverless Mode (Vercel)
    module.exports = async (req, res) => {
        try {
            await connectToDatabase();
            return app(req, res);
        } catch (error) {
            console.error("Serverless Function Entry Point Error:", error);
            res.status(500).json({
                error: "Dossier Intelligence Initialization Failed",
                details: error.message
            });
        }
    };
}