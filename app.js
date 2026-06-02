const express = require("express");
const nodemailer = require("nodemailer");
const { Pool } = require("pg");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const csv = require("csv-parse/sync");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const BASE_URL =
  process.env.BASE_URL || "https://cyber-registration-paragon.onrender.com";

// =======================
// ESCAPE HTML
// =======================
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeJsString(str) {
  if (!str) return "";
  return String(str)
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$")
    .replace(/</g, "\\u003C")
    .replace(/>/g, "\\u003E");
}

// =======================
// DATABASE
// =======================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

// =======================
// MAIL CONFIG
// =======================
const mailUser =
  process.env.SMTP_USER ||
  process.env.SEND_EMAIL_USER ||
  process.env.REGISTER_EMAIL_USER;

const mailPass =
  process.env.SMTP_PASS ||
  process.env.SEND_EMAIL_PASS ||
  process.env.REGISTER_EMAIL_PASS;

const mailFrom =
  process.env.SMTP_FROM ||
  (mailUser ? `"Paragon group" <${mailUser}>` : undefined);

const smtpHost = process.env.SMTP_HOST || "smtppro.zoho.com";
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpSecure = process.env.SMTP_SECURE === "true";

if (!mailUser || !mailPass) {
  console.error("MAIL CONFIG ERROR: Missing SMTP/SEND/REGISTER email user or password");
}

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpSecure,
  auth: {
    user: mailUser,
    pass: mailPass,
  },
  tls: {
    rejectUnauthorized: true,
  },
});

console.log("SMTP CONFIG DEBUG:", {
  host: smtpHost,
  port: smtpPort,
  secure: smtpSecure,
  user: mailUser,
  from: mailFrom,
  hasPassword: Boolean(mailPass),
});

transporter.verify((err) => {
  if (err) {
    console.error("SMTP ERROR:", err.message);
  } else {
    console.log("SMTP READY ✅", {
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      user: mailUser,
    });
  }
});

// =======================
// MAIL JOB STATUS
// =======================
let mailJob = {
  running: false,
  total: 0,
  sent: 0,
  failed: 0,
  results: [],
  startedAt: null,
  finishedAt: null,
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createToken(email) {
  return crypto
    .createHash("sha256")
    .update(String(email).toLowerCase().trim())
    .digest("hex")
    .slice(0, 32);
}

function getClientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",").pop().trim() ||
    req.socket.remoteAddress ||
    ""
  );
}

// =======================
// MIDDLEWARE
// =======================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

app.use(
  session({
    store: new pgSession({
      pool,
      tableName: "session",
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24,
    },
  })
);

// =======================
// AUTH MIDDLEWARE
// =======================
function requireAdmin(req, res, next) {
  if (!req.session.loggedIn) return res.redirect("/login");
  next();
}

// =======================
// INIT TABLES
// =======================
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS registrations (
      id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      company TEXT,
      department TEXT,
      phone TEXT,
      email TEXT NOT NULL,
      token TEXT,
      ip TEXT,
      user_agent TEXT,
      simulation_result TEXT DEFAULT 'submitted',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`ALTER TABLE registrations ADD COLUMN IF NOT EXISTS token TEXT`);
  await pool.query(`ALTER TABLE registrations ADD COLUMN IF NOT EXISTS ip TEXT`);
  await pool.query(`ALTER TABLE registrations ADD COLUMN IF NOT EXISTS user_agent TEXT`);
  await pool.query(`ALTER TABLE registrations ADD COLUMN IF NOT EXISTS simulation_result TEXT DEFAULT 'submitted'`);
  await pool.query(`ALTER TABLE registrations ADD COLUMN IF NOT EXISTS department TEXT`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS clicks (
      id SERIAL PRIMARY KEY,
      token TEXT,
      employee_name TEXT,
      employee_email TEXT,
      ip TEXT,
      user_agent TEXT,
      clicked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      registered BOOLEAN DEFAULT FALSE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS employees (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mail_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      subject TEXT NOT NULL DEFAULT 'עדכון: שינוי מדיניות ימי חופש',
      intro TEXT NOT NULL DEFAULT 'פורסם עדכון בנושא מדיניות ימי חופש לעובדי החברה.',
      file_name TEXT NOT NULL DEFAULT 'מדיניות_ימי_חופש_2026.pdf',
      file_size TEXT NOT NULL DEFAULT '879 KB',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    INSERT INTO mail_settings (id) VALUES (1)
    ON CONFLICT (id) DO NOTHING
  `);

  console.log("Database ready ✅");
}

initDb().catch((err) => {
  console.error("DB INIT ERROR:", err);
});

// =======================
// HOME + CLICK TRACKING
// =======================
app.get("/", async (req, res) => {
  const token = req.query.u || "";
  let emp = null;

  if (token) {
    try {
      const result = await pool.query(`SELECT * FROM employees WHERE active = true`);
      emp = result.rows.find((e) => createToken(e.email) === token);
    } catch (err) {
      console.error("FIND EMPLOYEE ERROR:", err.message);
    }

    try {
      const ip = getClientIp(req);

      const alreadyClicked = await pool.query(
        "SELECT 1 FROM clicks WHERE token = $1 AND ip = $2 LIMIT 1",
        [token, ip]
      );

      if (alreadyClicked.rowCount === 0) {
        await pool.query(
          `
          INSERT INTO clicks (token, employee_name, employee_email, ip, user_agent)
          VALUES ($1, $2, $3, $4, $5)
        `,
          [
            token,
            emp ? emp.name : "Unknown",
            emp ? emp.email : "Unknown",
            ip,
            req.headers["user-agent"] || "",
          ]
        );

        console.log("Click saved:", emp ? emp.email : token);
      }
    } catch (err) {
      console.error("CLICK ERROR:", err.message);
    }
  }

  res.render("index", {
    name: emp ? emp.name : "משתמש",
    token,
  });
});

// =======================
// REGISTER
// =======================
app.post("/register", async (req, res) => {
  const { full_name, company, phone, email, token, department } = req.body;

  if (!full_name || !email) {
    return res.status(400).send("חסר שם או אימייל");
  }

  try {
    const ip = getClientIp(req);

    await pool.query(
      `
      INSERT INTO registrations
      (full_name, company, phone, email, token, ip, user_agent, simulation_result, department)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        full_name,
        company || "",
        phone || "",
        email,
        token || null,
        ip,
        req.headers["user-agent"] || "",
        "submitted",
        department || "",
      ]
    );

    if (token) {
      await pool.query(`UPDATE clicks SET registered = true WHERE token = $1`, [token]);
    }

    await transporter.sendMail({
      from: mailFrom,
      to: email,
      subject: "אישור הרשמה להרצאת סייבר",
      html: `
        <div dir="rtl" style="font-family:Arial; line-height:1.6">
          <h2>שלום ${escapeHtml(full_name)},</h2>
          <p>נרשמת בהצלחה להרצאת הסייבר של Paragon 🔐</p>
          <p><strong>פרטי ההרצאה:</strong></p>
          <ul style="padding-right:20px">
            <li>📅 תאריך: X</li>
            <li>⏰ שעה: X</li>
            <li>💻 פלטפורמה: Zoom</li>
          </ul>
          <p>קישור לזום יישלח סמוך למועד ההרצאה.</p>
          <br>
          <p>נתראה בהרצאה,<br>Paragon group</p>
        </div>
      `,
    });

    res.sendFile(path.join(__dirname, "views", "success.html"));
  } catch (err) {
    console.error("REGISTER ERROR:", err.message);
    res.status(500).send("שגיאה בהרשמה או בשליחת מייל");
  }
});

// =======================
// SEND TRACKING EMAILS
// =======================
async function sendTrackingEmails() {
  const result = await pool.query(
    `SELECT * FROM employees WHERE active = true ORDER BY created_at ASC`
  );

  const employees = result.rows;

  const settingsResult = await pool.query(`SELECT * FROM mail_settings WHERE id = 1`);
  const settings = settingsResult.rows[0];

  mailJob = {
    running: true,
    total: employees.length,
    sent: 0,
    failed: 0,
    results: [],
    startedAt: new Date(),
    finishedAt: null,
  };

  for (const emp of employees) {
    const token = createToken(emp.email);
    const link = `${BASE_URL}/?u=${token}`;

    try {
      await transporter.sendMail({
        from: mailFrom,
        to: emp.email,
        subject: settings.subject,
        html: `
          <div dir="rtl" style="font-family: Arial, sans-serif; color: #222; line-height: 1.7; max-width: 480px;">
            <p>שלום ${escapeHtml(emp.name)},</p>
            <p>${escapeHtml(settings.intro)}</p>
            <p style="font-size: 12px; color: #888;">Last changed: Thursday, March 17, 2022</p>

            <table cellpadding="0" cellspacing="0" border="0" style="background: #ffffff; border: 1px solid #d6d6d6; border-radius: 12px; min-width: 240px; max-width: 290px; box-shadow: 0 1px 4px rgba(0,0,0,0.08);">
              <tr>
                <td style="padding: 12px 8px 12px 14px; vertical-align: middle; width: 48px;">
                  <svg width="38" height="46" viewBox="0 0 38 46" xmlns="http://www.w3.org/2000/svg">
                    <path d="M4 0 H26 L38 12 V42 Q38 46 34 46 H4 Q0 46 0 42 V4 Q0 0 4 0Z" fill="#e8f0fe"/>
                    <path d="M26 0 L38 12 H28 Q26 12 26 10 Z" fill="#a8c4f5"/>
                    <rect x="5" y="28" width="28" height="12" rx="2" fill="#ea4335"/>
                    <text x="19" y="38" font-family="Arial" font-size="8" font-weight="bold" fill="white" text-anchor="middle">PDF</text>
                    <rect x="6" y="16" width="18" height="2" rx="1" fill="#a8c4f5"/>
                    <rect x="6" y="21" width="22" height="2" rx="1" fill="#a8c4f5"/>
                  </svg>
                </td>
                <td style="padding: 12px 8px 12px 4px; vertical-align: middle;">
                  <a href="${link}" style="text-decoration: none; display: block;">
                    <div style="font-size: 13px; font-weight: 600; color: #0078d4; white-space: nowrap;">${escapeHtml(settings.file_name)}</div>
                    <div style="font-size: 11px; color: #888; margin-top: 2px;">${escapeHtml(settings.file_size)}</div>
                  </a>
                </td>
                <td style="padding: 12px 14px 12px 8px; vertical-align: middle;">
                  <a href="${link}" style="color: #aaa; font-size: 16px; text-decoration: none;">&#8964;</a>
                </td>
              </tr>
            </table>

            <p style="margin-top: 20px; font-size: 12px; color: #999;">Paragon Group</p>
          </div>
        `,
      });

      mailJob.sent++;
      mailJob.results.push({
        name: emp.name,
        email: emp.email,
        status: "נשלח",
        error: "",
      });

      console.log("MAIL SENT:", emp.email);
    } catch (err) {
      mailJob.failed++;
      mailJob.results.push({
        name: emp.name,
        email: emp.email,
        status: "נכשל",
        error: err.message,
      });

      console.error("MAIL FAILED:", emp.email, err.message);
    }

    await delay(1200);
  }

  mailJob.running = false;
  mailJob.finishedAt = new Date();
}

// =======================
// LOGIN
// =======================
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "login.html"));
});

app.get("/register-page", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "register.html"));
});

app.post("/login", (req, res) => {
  const { user, password } = req.body;

  if (user === process.env.ADMIN_USER && password === process.env.ADMIN_PASSWORD) {
    req.session.loggedIn = true;
    return res.redirect("/admin");
  }

  res.status(401).send("פרטים שגויים");
});

// =======================
// SEND MAILS
// =======================
app.post("/admin/send-mails", requireAdmin, async (req, res) => {
  if (mailJob.running) return res.redirect("/admin");

  sendTrackingEmails().catch((err) => {
    console.error("MAIL JOB ERROR:", err.message);
    mailJob.running = false;
    mailJob.finishedAt = new Date();
    mailJob.results.push({
      name: "SYSTEM",
      email: "",
      status: "נכשל",
      error: err.message,
    });
  });

  res.redirect("/admin");
});

// =======================
// ADD EMPLOYEE
// =======================
app.post("/admin/add-employee", requireAdmin, async (req, res) => {
  const { name, email } = req.body;

  if (!name || !email) return res.redirect("/admin");

  try {
    await pool.query(
      `
      INSERT INTO employees (name, email)
      VALUES ($1, $2)
      ON CONFLICT (email) DO NOTHING
      `,
      [name.trim(), email.trim().toLowerCase()]
    );
  } catch (err) {
    console.error("ADD EMPLOYEE ERROR:", err.message);
  }

  res.redirect("/admin");
});

// =======================
// IMPORT EMPLOYEES FROM CSV
// =======================
app.post("/admin/import-csv", requireAdmin, upload.single("csvfile"), async (req, res) => {
  try {
    if (!req.file) return res.redirect("/admin");

    const content = req.file.buffer.toString("utf-8");

    const records = csv.parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    let added = 0;

    for (const row of records) {
      const name = row["name"] || row["שם"] || row["Name"] || "";
      const email = row["email"] || row["מייל"] || row["Email"] || "";

      if (name && email) {
        await pool.query(
          `
          INSERT INTO employees (name, email)
          VALUES ($1, $2)
          ON CONFLICT (email) DO NOTHING
          `,
          [String(name).trim(), String(email).trim().toLowerCase()]
        );
        added++;
      }
    }

    console.log(`CSV imported: ${added} employees`);
  } catch (err) {
    console.error("CSV IMPORT ERROR:", err.message);
  }

  res.redirect("/admin");
});

// =======================
// DELETE EMPLOYEE
// =======================
app.post("/admin/delete-employee", requireAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM employees WHERE id = $1`, [req.body.id]);
  } catch (err) {
    console.error("DELETE EMPLOYEE ERROR:", err.message);
  }

  res.redirect("/admin");
});

// =======================
// UPDATE MAIL SETTINGS
// =======================
app.post("/admin/mail-settings", requireAdmin, async (req, res) => {
  const { subject, intro, file_name, file_size } = req.body;

  try {
    await pool.query(
      `
      UPDATE mail_settings
      SET subject = $1,
          intro = $2,
          file_name = $3,
          file_size = $4,
          updated_at = NOW()
      WHERE id = 1
      `,
      [
        subject || "",
        intro || "",
        file_name || "",
        file_size || "",
      ]
    );
  } catch (err) {
    console.error("MAIL SETTINGS ERROR:", err.message);
  }

  res.redirect("/admin");
});

// =======================
// MAIL STATUS
// =======================
app.get("/admin/mail-status", requireAdmin, (req, res) => {
  res.json(mailJob);
});

// =======================
// ADMIN
// =======================
app.get("/admin", requireAdmin, async (req, res) => {
  try {
    const registrations = await pool.query(
      `SELECT * FROM registrations ORDER BY created_at DESC`
    );

    const clickedNotRegistered = await pool.query(`
      SELECT c.token,
             c.employee_name,
             c.employee_email,
             MAX(c.clicked_at) AS clicked_at,
             COUNT(*) AS click_count,
             MAX(c.ip) AS ip
      FROM clicks c
      WHERE NOT EXISTS (
        SELECT 1 FROM registrations r WHERE r.token = c.token
      )
      GROUP BY c.token, c.employee_name, c.employee_email
      ORDER BY clicked_at DESC
    `);

    const employees = await pool.query(
      `SELECT * FROM employees ORDER BY created_at DESC`
    );

    const mailSettings = await pool.query(`SELECT * FROM mail_settings WHERE id = 1`);
    const settings = mailSettings.rows[0];

    const totalClicks = await pool.query(`SELECT COUNT(*) FROM clicks`);
    const totalRegs = await pool.query(`SELECT COUNT(*) FROM registrations`);
    const totalEmployees = await pool.query(
      `SELECT COUNT(*) FROM employees WHERE active = true`
    );

    const clicked = parseInt(totalClicks.rows[0].count, 10);
    const registered = parseInt(totalRegs.rows[0].count, 10);
    const total = parseInt(totalEmployees.rows[0].count, 10);
    const notClicked = Math.max(0, total - clicked);
    const clickedNotReg = Math.max(0, clicked - registered);

    let registrationRows = "";
    registrations.rows.forEach((r) => {
      registrationRows += `
        <tr>
          <td>${escapeHtml(r.full_name)}</td>
          <td>${escapeHtml(r.company)}</td>
          <td>${escapeHtml(r.department)}</td>
          <td>${escapeHtml(r.phone)}</td>
          <td>${escapeHtml(r.email)}</td>
          <td>${escapeHtml(r.created_at)}</td>
          <td>${escapeHtml(r.ip)}</td>
          <td>
            <form method="POST" action="/delete">
              <input type="hidden" name="id" value="${escapeHtml(r.id)}">
              <button onclick="return confirm('אתה בטוח?')">מחק</button>
            </form>
          </td>
        </tr>`;
    });

    let clickRows = "";
    clickedNotRegistered.rows.forEach((v) => {
      clickRows += `
        <tr>
          <td>${escapeHtml(v.employee_name)}</td>
          <td>${escapeHtml(v.employee_email)}</td>
          <td>${escapeHtml(v.clicked_at || "")}</td>
          <td>${escapeHtml(v.ip)}</td>
          <td>${escapeHtml(v.click_count || 0)}</td>
        </tr>`;
    });

    let employeeRows = "";
    employees.rows.forEach((e) => {
      employeeRows += `
        <tr>
          <td>${escapeHtml(e.name)}</td>
          <td>${escapeHtml(e.email)}</td>
          <td>${e.active ? "✅" : "❌"}</td>
          <td>
            <form method="POST" action="/admin/delete-employee">
              <input type="hidden" name="id" value="${escapeHtml(e.id)}">
              <button onclick="return confirm('למחוק?')">מחק</button>
            </form>
          </td>
        </tr>`;
    });

    let mailJobRows = "";
    mailJob.results.forEach((r) => {
      const color =
        r.status === "נשלח"
          ? "#22c55e"
          : r.status === "בתהליך"
            ? "#f59e0b"
            : "#ef4444";

      const icon =
        r.status === "נשלח"
          ? "✅"
          : r.status === "בתהליך"
            ? "⏳"
            : "❌";

      mailJobRows += `
        <tr>
          <td>${escapeHtml(r.name)}</td>
          <td>${escapeHtml(r.email)}</td>
          <td style="color:${color};font-weight:bold;">${icon} ${escapeHtml(r.status)}</td>
          <td style="${r.error ? "color:#ef4444;" : ""}">${escapeHtml(r.error)}</td>
        </tr>`;
    });

    res.send(`
      <html dir="rtl">
      <head>
        <meta charset="UTF-8">
        <title>אדמין</title>
        <link rel="stylesheet" href="/admin.css">
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      </head>
      <body>
        <div class="content">
          <h2>מערכת אדמין</h2>

          <div class="stats">
            <div class="card">
              <div class="big-number">${totalClicks.rows[0].count}</div>
              <div class="label">👆 לחיצות</div>
            </div>
            <div class="card">
              <div class="big-number">${totalRegs.rows[0].count}</div>
              <div class="label">✅ נרשמים</div>
            </div>
            <div class="card">
              <div class="big-number">${totalEmployees.rows[0].count}</div>
              <div class="label">👥 עובדים</div>
            </div>
          </div>

          <div class="top-bar">
            <a href="/logout" class="logout-btn">🚪 יציאה</a>

            <form method="POST" action="/admin/send-mails">
              <button type="submit" onclick="return confirm('בטוח לשלוח לכל העובדים?')">📤 שלח מיילים</button>
            </form>

            <form method="POST" action="/admin/reset-clicks" onsubmit="return confirm('בטוח לאפס?')">
              <button class="reset-clicks-btn">איפוס קליקים ⚠️</button>
            </form>
          </div>

          <div class="tabs">
            <button class="tab-btn active" onclick="showTab('employees', this)">👥 עובדים (${total})</button>
            <button class="tab-btn" onclick="showTab('registrations', this)">✅ נרשמים (${registered})</button>
            <button class="tab-btn" onclick="showTab('clicks', this)">👆 קליקים (${clicked})</button>
            <button class="tab-btn" onclick="showTab('mails', this)">📤 מיילים</button>
            <button class="tab-btn" onclick="showTab('settings', this)">⚙️ הגדרות</button>
            <button class="tab-btn" onclick="showTab('stats', this)">📊 גרף</button>
          </div>

          <div id="tab-employees" class="tab-content active">
            <h3>👥 ניהול עובדים</h3>

            <form method="POST" action="/admin/add-employee" class="add-employee-form">
              <input type="text" name="name" placeholder="שם עובד" required>
              <input type="email" name="email" placeholder="מייל עובד" required>
              <button type="submit">➕ הוסף</button>
            </form>

            <form method="POST" action="/admin/import-csv" enctype="multipart/form-data" class="add-employee-form" style="margin-top:10px;">
              <input type="file" name="csvfile" accept=".csv" required style="color:white;">
              <button type="submit" style="background: linear-gradient(135deg, #059669, #047857);">📥 ייבוא CSV</button>
            </form>

            <p style="font-size:12px;color:#94a3b8;margin-top:6px;">
              קובץ CSV חייב לכלול עמודות: <strong>name</strong> ו-<strong>email</strong> או בעברית: שם, מייל
            </p>

            <table>
              <tr>
                <th>שם</th>
                <th>מייל</th>
                <th>פעיל</th>
                <th>פעולות</th>
              </tr>
              ${employeeRows}
            </table>
          </div>

          <div id="tab-registrations" class="tab-content">
            <h3>✅ נרשמים</h3>
            <input type="text" id="search" placeholder="🔍 חפש..." onkeyup="searchTable()">
            <table id="reg-table">
              <tr>
                <th>שם</th>
                <th>חברה</th>
                <th>מחלקה</th>
                <th>טלפון</th>
                <th>אימייל</th>
                <th>תאריך</th>
                <th>IP</th>
                <th>פעולות</th>
              </tr>
              ${registrationRows}
            </table>
          </div>

          <div id="tab-clicks" class="tab-content">
            <h3>👆 לחצו ולא נרשמו</h3>
            <table>
              <tr>
                <th>שם עובד</th>
                <th>מייל</th>
                <th>זמן לחיצה אחרון</th>
                <th>IP</th>
                <th>כמות לחיצות</th>
              </tr>
              ${clickRows}
            </table>
          </div>

          <div id="tab-mails" class="tab-content">
            <h3>📤 סטטוס שליחת מיילים</h3>
            <p>מצב: ${mailJob.running ? "רץ עכשיו 🟡" : "לא רץ ⚪"}</p>
            <p>סך הכל: ${mailJob.total} | נשלחו: ${mailJob.sent} | נכשלו: ${mailJob.failed}</p>

            <table>
              <tr>
                <th>שם</th>
                <th>מייל</th>
                <th>סטטוס</th>
                <th>שגיאה</th>
              </tr>
              <tbody id="mailJobTable">
                ${mailJobRows}
              </tbody>
            </table>
          </div>

          <div id="tab-settings" class="tab-content">
            <h3>⚙️ עריכת תוכן המייל</h3>

            <form method="POST" action="/admin/mail-settings" class="settings-form">
              <label>נושא המייל</label>
              <input type="text" name="subject" value="${escapeHtml(settings.subject)}" required>

              <label>תוכן המייל - פתיח</label>
              <input type="text" name="intro" value="${escapeHtml(settings.intro)}" required>

              <label>שם הקובץ</label>
              <input type="text" name="file_name" value="${escapeHtml(settings.file_name)}" required>

              <label>גודל הקובץ</label>
              <input type="text" name="file_size" value="${escapeHtml(settings.file_size)}" required>

              <button type="submit">💾 שמור שינויים</button>
            </form>
          </div>

          <div id="tab-stats" class="tab-content">
            <h3>📊 סטטיסטיקות</h3>
            <div style="max-width: 380px; margin: 0 auto;">
              <canvas id="statsChart"></canvas>
            </div>
          </div>
        </div>

        <script>
          function showTab(name, btn) {
            document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));
            document.querySelectorAll(".tab-btn").forEach(el => el.classList.remove("active"));
            document.getElementById("tab-" + name).classList.add("active");
            btn.classList.add("active");
            localStorage.setItem("activeTab", name);
          }

          const savedTab = localStorage.getItem("activeTab");
          if (savedTab) {
            const tabEl = document.getElementById("tab-" + savedTab);
            if (tabEl) {
              document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));
              document.querySelectorAll(".tab-btn").forEach(el => el.classList.remove("active"));
              tabEl.classList.add("active");

              document.querySelectorAll(".tab-btn").forEach(btn => {
                if (btn.getAttribute("onclick") && btn.getAttribute("onclick").includes("'" + savedTab + "'")) {
                  btn.classList.add("active");
                }
              });
            }
          }

          function searchTable() {
            const input = document.getElementById("search").value.toLowerCase();
            const rows = document.querySelectorAll("#reg-table tr");

            rows.forEach((row, i) => {
              if (i === 0) return;
              row.style.display = row.innerText.toLowerCase().includes(input) ? "" : "none";
            });
          }

          function safeText(value) {
            return value == null ? "" : String(value);
          }

          async function updateMailStatus() {
            try {
              const res = await fetch("/admin/mail-status");
              const data = await res.json();

              const table = document.getElementById("mailJobTable");
              if (!table || !Array.isArray(data.results)) {
                setTimeout(updateMailStatus, 2000);
                return;
              }

              table.innerHTML = "";

              data.results.forEach(r => {
                const status = safeText(r.status);
                const color = status === "נשלח" ? "#22c55e" : status === "בתהליך" ? "#f59e0b" : "#ef4444";
                const icon = status === "נשלח" ? "✅" : status === "בתהליך" ? "⏳" : "❌";

                const tr = document.createElement("tr");

                const tdName = document.createElement("td");
                tdName.textContent = safeText(r.name);

                const tdEmail = document.createElement("td");
                tdEmail.textContent = safeText(r.email);

                const tdStatus = document.createElement("td");
                tdStatus.style.color = color;
                tdStatus.style.fontWeight = "bold";
                tdStatus.textContent = icon + " " + status;

                const tdError = document.createElement("td");
                if (r.error) tdError.style.color = "#ef4444";
                tdError.textContent = safeText(r.error);

                tr.appendChild(tdName);
                tr.appendChild(tdEmail);
                tr.appendChild(tdStatus);
                tr.appendChild(tdError);

                table.appendChild(tr);
              });

              if (data.running) setTimeout(updateMailStatus, 2000);
            } catch (err) {
              setTimeout(updateMailStatus, 3000);
            }
          }

          updateMailStatus();

          const ctx = document.getElementById("statsChart").getContext("2d");

          new Chart(ctx, {
            type: "doughnut",
            data: {
              labels: ["נרשמו ✅", "לחצו ולא נרשמו 👆", "לא לחצו ❌"],
              datasets: [{
                data: [${registered}, ${clickedNotReg}, ${notClicked}],
                backgroundColor: ["#22c55e", "#f59e0b", "#ef4444"],
                borderWidth: 2,
                borderColor: "#111827"
              }]
            },
            options: {
              plugins: {
                legend: {
                  labels: {
                    color: "#e5e7eb",
                    font: { size: 14 }
                  }
                }
              }
            }
          });
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    console.error("ADMIN ERROR:", err.message);
    res.status(500).send("שגיאה בטעינת אדמין");
  }
});

// =======================
// RESET CLICKS
// =======================
app.post("/admin/reset-clicks", requireAdmin, async (req, res) => {
  try {
    await pool.query("TRUNCATE clicks RESTART IDENTITY");
    res.redirect("/admin");
  } catch (err) {
    console.error("RESET CLICKS ERROR:", err.message);
    res.status(500).send("שגיאה באיפוס");
  }
});

// =======================
// DELETE REGISTRATION
// =======================
app.post("/delete", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM registrations WHERE id = $1", [req.body.id]);
    res.redirect("/admin");
  } catch (err) {
    console.error("DELETE ERROR:", err.message);
    res.status(500).send("שגיאה במחיקה");
  }
});

// =======================
// LOGOUT
// =======================
app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// =======================
// START
// =======================
const port = process.env.PORT || 3000;

app.listen(port, "0.0.0.0", () => {
  console.log("✅ Server running on port " + port);
});