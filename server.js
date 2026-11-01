/* =====================================================================
   VOLTPRO ELECTRICAL SOLUTIONS - BACKEND SERVER (Node.js + Express)
   ---------------------------------------------------------------------
   What this server does
     1. Serves your website files from the /public folder.
     2. POST /api/contact  receives the contact form, checks it, blocks
        spam, SAVES it to data/messages.jsonl and EMAILS it to you.
     3. GET  /api/messages lets only you read the saved messages
        (needs the ADMIN_TOKEN from your .env file).
     4. GET  /api/health   quick "is the server alive" check.

   Run it:   npm install   then   npm start   then open http://localhost:3000
   Settings: copy .env.example to .env and fill it in (see README.md).
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
app.use(express.static(__dirname));
/* ---------- Settings (from .env) ---------- */
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.join(__dirname, "data");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.jsonl");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const CONTACT_TO = process.env.CONTACT_TO || process.env.SMTP_USER || "";

// The services allowed in the form. Must match the <option> texts in index.html
const SERVICES = [
    "Residential Electrical",
    "Commercial Electrical",
    "Industrial Electrical",
    "Electrical Repairs",
    "Lighting Solutions",
    "Maintenance and Safety",
    "Other",
];

/* ---------- Basic safety for the whole app ---------- */
app.disable("x-powered-by");
// contentSecurityPolicy is off so Google Fonts and Unsplash pictures keep working.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1); // needed on Render, Railway, etc.
app.use(express.json({ limit: "20kb" }));                  // refuse huge requests
app.use(express.static(path.join(__dirname, "public")));   // your website

/* ---------- Email (optional) ---------- */
// Email is only switched on when the SMTP_* settings exist in .env.
// If they are missing, messages are still saved to the file below.
let mailer = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const port = Number(process.env.SMTP_PORT) || 465;
    mailer = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,                              // 465 = SSL, 587 = STARTTLS
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    mailer.verify()
        .then(() => console.log("Email: connected to " + process.env.SMTP_HOST))
        .catch(err => console.warn("Email: could NOT connect (" + err.message + "). Messages will still be saved to file."));
} else {
    console.log("Email: not configured (add SMTP_* to .env). Messages are saved to data/messages.jsonl only.");
}

/* ---------- Helpers ---------- */
// Remove control characters and trim. Keeps line breaks only when asked.
function clean(value, { multiline = false } = {}) {
    let s = String(value ?? "");
    s = multiline ? s.replace(/[^\S\n]+/g, " ").replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "")
                  : s.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ");
    return s.trim();
}

// Make text safe to put inside an HTML email (stops injected HTML/scripts).
function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Check the data and return { errors, values }
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
    fs.appendFileSync(MESSAGES_FILE, JSON.stringify(record) + "\n", "utf8");   // one JSON message per line
}

async function emailMessage(m) {
    await mailer.sendMail({
        from: `"VoltPro Website" <${process.env.SMTP_USER}>`,
        to: CONTACT_TO,
        replyTo: `"${m.name.replace(/"/g, "")}" <${m.email}>`,      // press Reply to answer the customer
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

    // Honeypot: a hidden field that only bots fill in. Pretend success, store nothing.
    if (body.website) return res.status(200).json({ ok: true, message: "Thank you." });

    const { errors, values } = validate(body);
    if (Object.keys(errors).length) {
        return res.status(400).json({ ok: false, error: "Please check the form and try again.", fields: errors });
    }

    const record = { id: crypto.randomUUID(), receivedAt: new Date().toISOString(), ...values };

    // 1) Save first, so a message is never lost even if email fails.
    try {
        saveMessage(record);
    } catch (err) {
        console.error("Could not save message:", err);
        return res.status(500).json({ ok: false, error: "Sorry, something went wrong on our side. Please call or email us instead." });
    }

    // 2) Then try to email it to the business owner.
    let emailed = false;
    if (mailer && CONTACT_TO) {
        try { await emailMessage(record); emailed = true; }
        catch (err) { console.error("Email failed (message is still saved):", err.message); }
    }

    return res.status(201).json({
        ok: true,
        emailed,
        message: "Thank you! Your message has been received and our team will get back to you.",
    });
});

/* ---------- API: read saved messages (owner only) ---------- */
app.get("/api/messages", (req, res) => {
    const sent = String(req.get("x-admin-token") || "");
    const a = Buffer.from(sent), b = Buffer.from(ADMIN_TOKEN);
    const ok = ADMIN_TOKEN.length >= 12 && a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) return res.status(401).json({ ok: false, error: "Unauthorized." });

    if (!fs.existsSync(MESSAGES_FILE)) return res.json({ ok: true, count: 0, messages: [] });
    const messages = fs.readFileSync(MESSAGES_FILE, "utf8").split("\n").filter(Boolean)
        .map(line => { try { return JSON.parse(line); } catch (e) { return null; } })
        .filter(Boolean).reverse();                         // newest first
    res.json({ ok: true, count: messages.length, messages });
});
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(require('path').join(__dirname, 'index.html'));
});
app.get("/api/health", (req, res) => res.json({ ok: true, email: Boolean(mailer), time: new Date().toISOString() }));

/* ---------- Errors ---------- */

app.use("/api", (req, res) => res.status(404).json({ ok: false, error: "Not found." }));
app.use((err, req, res, next) => {                           // bad JSON, too-large body, etc.
    if (res.headersSent) return next(err);
    const status = err.status && err.status < 500 ? err.status : 500;
    res.status(status).json({ ok: false, error: status === 500 ? "Server error." : "Invalid request." });
});

if (require.main === module) {
    app.listen(PORT, () => console.log(`VoltPro server running: http://localhost:${PORT}`));
}
module.exports = app;
