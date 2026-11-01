/* =====================================================================
   VOLTPRO ELECTRICAL SOLUTIONS - BACKEND SERVER (Node.js + Express)
   Works on your computer (npm start) AND on Vercel.

   FILES IN THE ROOT OF YOUR REPO:
     server.js, package.json, vercel.json, index.html, style.css, script.js
     (optional folders: images/ or assets/)
   ===================================================================== */

require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const ON_VERCEL = Boolean(process.env.VERCEL);

/* ---------- Settings (from .env locally, from Vercel Environment Variables online) ---------- */
const PORT = Number(process.env.PORT) || 3000;
// Vercel's disk is read-only except /tmp (and /tmp is wiped often), so email is what really delivers messages there.
const DATA_DIR = ON_VERCEL ? "/tmp" : path.join(__dirname, "data");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.jsonl");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const CONTACT_TO = process.env.CONTACT_TO || process.env.SMTP_USER || "";

const SERVICES = [
    "Residential Electrical",
    "Commercial Electrical",
    "Industrial Electrical",
    "Electrical Repairs",
    "Lighting Solutions",
    "Maintenance and Safety",
    "Other",
];

/* ---------- Basic safety ---------- */
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
if (ON_VERCEL || process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1);
app.use(express.json({ limit: "20kb" }));

/* ---------- WEBSITE FILES (this is what fixes the missing colours) ----------
   Only these files are public. server.js, package.json and .env are NOT served. */
const ROOT = __dirname;
const PAGE_FILES = ["index.html", "style.css", "script.js"];

app.get("/", (req, res) => res.sendFile(path.join(ROOT, "index.html")));
PAGE_FILES.forEach(file => {
    app.get("/" + file, (req, res) => res.sendFile(path.join(ROOT, file)));
});
// Optional folders for pictures. Create the folder and put files in it if you need them.
["images", "assets", "public"].forEach(dir => {
    app.use("/" + dir, express.static(path.join(ROOT, dir)));
});
// Option: if you keep everything inside a /public folder instead, it is served too.
app.use(express.static(path.join(ROOT, "public")));

/* ---------- Email (optional) ---------- */
let mailer = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const port = Number(process.env.SMTP_PORT) || 465;
    mailer = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    if (!ON_VERCEL) {
        mailer.verify()
            .then(() => console.log("Email: connected to " + process.env.SMTP_HOST))
            .catch(err => console.warn("Email: could NOT connect (" + err.message + ")."));
    }
} else {
    console.log("Email: not configured (add SMTP_* settings). Messages are only saved to file.");
}

/* ---------- Helpers ---------- */
function clean(value, { multiline = false } = {}) {
    let s = String(value ?? "");
    s = multiline ? s.replace(/[^\S\n]+/g, " ").replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "")
                  : s.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ");
    return s.trim();
}

function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function validate(body) {
    const values = {
        name: clean(body.name),
        email: clean(body.email).toLowerCase(),
        service: clean(body.service),
        message: clean(body.message, { multiline: true }),
    };
    const errors = {};
    if (values.name.length < 2 || values.name.length > 80) errors.name = "Please enter your full name (2-80 characters).";
    if (values.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email)) errors.email = "Please enter a valid email address.";
    if (!SERVICES.includes(values.service)) errors.service = "Please choose a service from the list.";
    if (values.message.length < 10 || values.message.length > 2000) errors.message = "Your message must be 10-2000 characters.";
    return { errors, values };
}

function saveMessage(record) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(MESSAGES_FILE, JSON.stringify(record) + "\n", "utf8");
}

async function emailMessage(m) {
    await mailer.sendMail({
        from: `"VoltPro Website" <${process.env.SMTP_USER}>`,
        to: CONTACT_TO,
        replyTo: `"${m.name.replace(/"/g, "")}" <${m.email}>`,
        subject: `New website enquiry: ${m.service} - ${m.name}`,
        text: `Name: ${m.name}\nEmail: ${m.email}\nService: ${m.service}\nReceived: ${m.receivedAt}\n\n${m.message}\n`,
        html: `<h2>New website enquiry</h2>
               <p><strong>Name:</strong> ${escapeHtml(m.name)}<br>
               <strong>Email:</strong> ${escapeHtml(m.email)}<br>
               <strong>Service:</strong> ${escapeHtml(m.service)}<br>
               <strong>Received:</strong> ${escapeHtml(m.receivedAt)}</p>
               <p style="white-space:pre-wrap">${escapeHtml(m.message)}</p>`,
    });
}

/* ---------- Spam protection: max 5 messages per 15 minutes per visitor ---------- */
const contactLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: "Too many messages from this connection. Please try again in a few minutes." },
});

/* ---------- API: contact form ---------- */
app.post("/api/contact", contactLimiter, async (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};

    if (body.website) return res.status(200).json({ ok: true, message: "Thank you." }); // bot trap

    const { errors, values } = validate(body);
    if (Object.keys(errors).length) {
        return res.status(400).json({ ok: false, error: "Please check the form and try again.", fields: errors });
    }

    const record = { id: crypto.randomUUID(), receivedAt: new Date().toISOString(), ...values };
    const canEmail = Boolean(mailer && CONTACT_TO);

    // 1) Try to save to file. A save problem only matters when email is not available either.
    let saved = true;
    try { saveMessage(record); }
    catch (err) { saved = false; console.error("Could not save message:", err.message); }

    // 2) Email it to the business owner.
    let emailed = false;
    if (canEmail) {
        try { await emailMessage(record); emailed = true; }
        catch (err) { console.error("Email failed:", err.message); }
    }

    if (!saved && !emailed) {
        return res.status(500).json({ ok: false, error: "Sorry, something went wrong on our side. Please call or email us instead." });
    }

    return res.status(201).json({
        ok: true,
        emailed,
        message: "Thank you! Your message has been received and our team will get back to you.",
    });
});

/* ---------- API: read saved messages (owner only; on Vercel this is temporary storage) ---------- */
app.get("/api/messages", (req, res) => {
    const sent = String(req.get("x-admin-token") || "");
    const a = Buffer.from(sent), b = Buffer.from(ADMIN_TOKEN);
    const ok = ADMIN_TOKEN.length >= 12 && a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) return res.status(401).json({ ok: false, error: "Unauthorized." });

    if (!fs.existsSync(MESSAGES_FILE)) return res.json({ ok: true, count: 0, messages: [] });
    const messages = fs.readFileSync(MESSAGES_FILE, "utf8").split("\n").filter(Boolean)
        .map(line => { try { return JSON.parse(line); } catch (e) { return null; } })
        .filter(Boolean).reverse();
    res.json({ ok: true, count: messages.length, messages });
});

app.get("/api/health", (req, res) => res.json({ ok: true, email: Boolean(mailer), vercel: ON_VERCEL, time: new Date().toISOString() }));

/* ---------- Errors ---------- */
app.use("/api", (req, res) => res.status(404).json({ ok: false, error: "Not found." }));
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status && err.status < 500 ? err.status : 500;
    res.status(status).json({ ok: false, error: status === 500 ? "Server error." : "Invalid request." });
});

// Local: start a server. Vercel: it imports the exported app instead.
if (require.main === module) {
    app.listen(PORT, () => console.log(`VoltPro server running: http://localhost:${PORT}`));
}
module.exports = app;
