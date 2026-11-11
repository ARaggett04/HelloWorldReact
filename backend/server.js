const express = require("express");
const Database = require("better-sqlite3");
const bcrypt = require("bcrypt");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();
const db = new Database("users.db");

app.use(express.json({limit:"10kb"}));
app.use(cors({origin: "http://localhost:5173"}));

db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT null,
        password_hash TEXT NOT null
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

    res.json({
        message: "Login successful!",
        username: user.username
    });
});

app.listen(3001, "127.0.0.1", () => {
    console.log("Backend running on port 3001");
});