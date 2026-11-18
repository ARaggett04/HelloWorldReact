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
        is_global INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
`).run();

db.prepare(`
    CREATE TABLE IF NOT EXISTS hidden_events (
    user_id INTEGER NOT NULL,
    event_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, event_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (event_id) REFERENCES events(id)
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
            id: user.id,
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
    const { title, description = "", date, time = null, is_global = false } = req.body;

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

    if (typeof is_global !== "boolean") {
        return res.status(400).json({
            message: "Invalid event visibility."
        });
    }

    const user = db.prepare(
        "SELECT role FROM users WHERE id = ?"
    ).get(req.session.userId);

    if (!user) {
        return res.status(401).json({
            message: "User account not found."
        });
    }

    if (is_global && user.role !== "admin") {
        return res.status(403).json({
            message: "Only admins can create global events."
        });
    }

    const result = db.prepare(`
        INSERT INTO events (user_id, title, description, date, time, is_global)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(
        req.session.userId,
        title.trim(),
        description,
        date,
        time || null,
        is_global ? 1 : 0
    );

    res.status(201).json({
        message: "Event created!",
        id: result.lastInsertRowid
    });
});

app.get("/api/events", requireLogin, (req, res) => {
    const events = db.prepare(`
        SELECT e.id, e.user_id, e.title, e.description, e.date, e.time, e.is_global
        FROM events e
        WHERE (e.user_id = ? OR e.is_global = 1)
            AND NOT EXISTS (
                SELECT 1
                FROM hidden_events h
                WHERE h.event_id = e.id
                    AND h.user_id = ?
            )
        ORDER BY e.date ASC, e.time ASC
    `).all(req.session.userId, req.session.userId);

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

app.delete("/api/events/:id", requireLogin, (req, res) => {
    const eventId = Number(req.params.id);

    if (!Number.isSafeInteger(eventId) || eventId <= 0) {
        return res.status(400).json({
            message: "Invalid event ID."
        });
    }

    const event = db.prepare(`
        SELECT user_id
        FROM events
        WHERE id = ?
    `).get(eventId);

    if (!event) {
        return res.status(404).json({
            message: "Event not found."
        });
    }

    if (event.user_id !== req.session.userId) {
        return res.status(403).json({
            message: "You cannot delete somebody else's event."
        });
    }

    const deleteEvent = db.transaction(() => {
        db.prepare(`
            DELETE FROM hidden_events
            WHERE event_id = ?
        `).run(eventId);

        db.prepare(`
            DELETE FROM events
            WHERE id = ?
        `).run(eventId);
    });

    deleteEvent();

    res.json({
        message: "Event deleted successfully."
    });
});

app.post("/api/events/:id/hide", requireLogin, (req, res) => {
    const eventId = Number(req.params.id);

    if (!Number.isSafeInteger(eventId) || eventId <= 0) {
        return res.status(400).json({
            message: "Invalid event ID."
        });
    }

    const event = db.prepare(`
        SELECT id
        FROM events
        WHERE id = ?
            AND (user_id = ? OR is_global = 1)
    `).get(eventId, req.session.userId);

    if (!event) {
        return res.status(404).json({
            message: "Event not found."
        });
    }

    db.prepare(`
        INSERT OR IGNORE INTO hidden_events (user_id, event_id)
        VALUES (?, ?)
    `).run(req.session.userId, eventId);

    res.json({
        message: "Event hidden successfully."
    });
});

app.get("/api/events/hidden", requireLogin, (req, res) => {
    const events = db.prepare(`
        SELECT
            e.id,
            e.user_id,
            e.title,
            e.description,
            e.date,
            e.time,
            e.is_global
        FROM events e
        JOIN hidden_events h ON h.event_id = e.id
        WHERE h.user_id = ?
            AND (e.user_id = ? OR e.is_global = 1)
        ORDER BY e.date ASC, e.time ASC
    `).all(req.session.userId, req.session.userId);

    res.json(events);
});

app.post("/api/events/:id/unhide", requireLogin, (req, res) => {
    const eventId = Number(req.params.id);

    if (!Number.isSafeInteger(eventId) || eventId <= 0) {
        return res.status(400).json({
            message: "Inbalid event ID."
        });
    }

    const event = db.prepare(`
        SELECT e.id
        FROM events e
        JOIN hidden_events h ON h.event_id = e.id
        WHERE e.id = ?
            AND h.user_id = ?
            AND (e.user_id = ? OR e.is_global = 1)
    `).get(eventId, req.session.userId, req.session.userId);

    if (!event) {
        return res.status(404).json({
            message: "Event not found."
        });
    }

    db.prepare(`
        DELETE FROM hidden_events
        WHERE user_id = ? AND event_id = ?
    `).run(req.session.userId, eventId);

    res.json({
        message: "Event restored successfully."
    });
});

app.listen(3001, "127.0.0.1", () => {
    console.log("Backend running on port 3001");
});