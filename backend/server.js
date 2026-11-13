const express = require("express");
const Database = require("better-sqlite3");
const bcrypt = require("bcrypt");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);

const app = express();
const db = new Database("users.db");

app.use(express.json({limit:"10kb"}));
app.use(cors({origin: "http://localhost:5173"}));
app.set("trust proxy", false);

app.use(session({
    store: new SQLiteStore({
        db: "sessions.db",
        dir: __dirname
    }),
    name: "calendar.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT null,
        password_hash TEXT NOT null,
        role TEXT NOT NULL DEFAULT 'user'
    )
`).run();

db.prepare(`
    CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        date TEXT NOT NULL,
        time TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
`).run();

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false
});

app.use("/api/signup", authLimiter);
app.use("/api/login", authLimiter);

app.post("/api/signup", async (req, res) => {
    const {username, password} = req.body || {};

    if (
        typeof username !== "string" ||
        typeof password !== "string" ||
        !/^[a-zA-Z0-9_]{3,30}$/.test(username) ||
        password.length < 8 ||
        Buffer.byteLength(password, "utf8") > 72
    ) {
        return res.status(400).json({
            message: "Use a 3-30 character username and a password of a least 8 characters"
        });
    }

    try {
        const hash = await bcrypt.hash(password, 12);

        db.prepare(
            "INSERT INTO users (username, password_hash) VALUES (?,?)"
        ).run(username, hash);

        res.status(201).json({
            message: "Account created!"
        });
    } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
            return res.status(409).json({
                message: "Username already taken."
            });
        }

        console.error(error);
        res.status(500).json({message: "Server error." });
    }
});

app.post("/api/login", async (req, res) => {
    const { username, password } = req.body || {};

    if (
        typeof username !== "string" ||
        typeof password !== "string"
    ) {
        return res.status(400).json({
            message: "Invalid username or password."
        });
    }

    const user = db.prepare(
        "SELECT * FROM users WHERE username = ?"
    ).get(username);

    const valid = user
        ? await bcrypt.compare(password, user.password_hash)
        : false;

    if (!valid) {
        return res.status(401).json({
            message: "Invalid username or password."
        });
    }

    req.session.regenerate((err) => {
        if (err) {
            return res.status(500).json({message: "Session error."});
        }

        req.session.userId = user.id;

        res.json({
            message: "Login successful!",
            username: user.username,
            role: user.role
        });
    });
});

function requireLogin(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({
            message: "Please log in first."
        });
    }

    next();
}

app.post("/api/events", requireLogin, (req, res) => {
    const { title, description = "", date, time = null } = req.body;

    if (
        typeof title !== "string" ||
        !title.trim() ||
        title.length > 200 ||
        typeof description !== "string" ||
        description.length > 5000 ||
        typeof date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
        (time !== null &&
         (typeof time !== "string" ||
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)))
    ) {
        return res.status(400).json({
            message: "Please enter valid event information."
        });
    }

    const result = db.prepare(`
        INSERT INTO events (user_id, title, description, date, time)
        VALUES (?, ?, ?, ?, ?)
    `).run(
        req.session.userId,
        title.trim(),
        description,
        date,
        time || null
    );

    res.status(201).json({
        message: "Event created!",
        id: result.lastInsertRowid
    });
});

app.get("/api/events", requireLogin, (req, res) => {
    const events = db.prepare(`
        SELECT id, title, description, date, time
        FROM events
        WHERE user_id = ?
        ORDER BY date ASC, time ASC
    `).all(req.session.userId);

    res.json(events);
});

app.post("/api/logout", requireLogin, (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({
                message: "Could not log out."
            });
        }

        res.clearCookie("calendar.sid");
        res.json({
            message: "Logged out."
        });
    });
});

app.listen(3001, "127.0.0.1", () => {
    console.log("Backend running on port 3001");
});