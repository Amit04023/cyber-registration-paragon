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

app.set("trust proxy", 1);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024,
  },
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const BASE_URL =
  cleanEnv(process.env.BASE_URL) || "https://cyber-registration-paragon.onrender.com";

// =======================
// HELPERS
// =======================
function cleanEnv(value) {
  if (value === undefined || value === null) return "";
  let cleaned = String(value).trim();

  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  return cleaned;
}

function escapeHtml(str) {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/`/g, "&#096;");
}

function formatDate(value) {
  if (!value) return "";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(String(value));

  return date.toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createToken(email) {
  return crypto
    .createHash("sha256")
    .update(String(email || "").toLowerCase().trim())
    .digest("hex")
    .slice(0, 32);
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return String(forwarded).split(",")[0].trim();
  }

  return req.socket.remoteAddress || "";
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
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
  cleanEnv(process.env.SMTP_USER) ||
  cleanEnv(process.env.SEND_EMAIL_USER) ||
  cleanEnv(process.env.REGISTER_EMAIL_USER);

const mailPass =
  cleanEnv(process.env.SMTP_PASS) ||
  cleanEnv(process.env.SEND_EMAIL_PASS) ||
  cleanEnv(process.env.REGISTER_EMAIL_PASS);

const mailFrom =
  cleanEnv(process.env.SMTP_FROM) ||
  (mailUser ? `Paragon group <${mailUser}>` : undefined);

const smtpHost = cleanEnv(process.env.SMTP_HOST) || "smtppro.zoho.com";
const smtpPort = Number(cleanEnv(process.env.SMTP_PORT) || 587);
const smtpSecure = String(cleanEnv(process.env.SMTP_SECURE) || "false").toLowerCase() === "true";

if (!mailUser || !mailPass) {
  console.error("MAIL CONFIG ERROR: Missing SMTP/SEND/REGISTER email user or password");
}

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpSecure,
  requireTLS: smtpPort === 587,
  auth: {
    user: mailUser,
    pass: mailPass,
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

// =======================
// EMAIL HTML: REALISTIC PDF CARD
// =======================
function buildPdfEmailHtml({ employeeName, intro, fileName, fileSize, link }) {
  const safeName = escapeHtml(employeeName || "עובד/ת");
  const safeIntro = escapeHtml(intro || "");
  const safeFileName = escapeHtml(fileName || "document.pdf");
  const safeFileSize = escapeHtml(fileSize || "");
  const safeLink = escapeAttr(link);

  return `
    <!DOCTYPE html>
    <html lang="he" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <title>${safeFileName}</title>
    </head>
    <body style="margin:0; padding:0; background:#f5f6f8; direction:rtl;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f5f6f8; border-collapse:collapse; direction:rtl;">
        <tr>
          <td align="right" style="padding:24px 16px; font-family:Arial, Helvetica, sans-serif;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px; background:#ffffff; border-collapse:collapse; border:1px solid #e5e7eb;">
              <tr>
                <td style="padding:24px 24px 10px 24px; font-family:Arial, Helvetica, sans-serif; color:#202124; text-align:right;">
                  <p style="margin:0 0 14px 0; font-size:15px; line-height:1.7;">שלום ${safeName},</p>
                  <p style="margin:0 0 8px 0; font-size:15px; line-height:1.7;">${safeIntro}</p>
                  <p style="margin:0 0 18px 0; font-size:12px; line-height:1.5; color:#777777;">Last changed: Thursday, March 17, 2022</p>
                </td>
              </tr>

              <tr>
                <td align="right" style="padding:0 24px 22px 24px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate; border-spacing:0; width:100%; max-width:430px; background:#ffffff; border:1px solid #d9dde3; border-radius:10px;">
                    <tr>
                      <td style="padding:14px 14px 14px 10px; width:58px; vertical-align:top;">
                        <a href="${safeLink}" target="_blank" style="text-decoration:none; display:inline-block;">
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                            <tr>
                              <td align="center" style="width:42px; height:52px; background:#ffffff; border:1px solid #cfd4dc; border-radius:4px; font-family:Arial, Helvetica, sans-serif;">
                                <div style="height:11px; line-height:11px; font-size:1px; background:#eef2f7; border-bottom:1px solid #d9dde3;">&nbsp;</div>
                                <div style="padding-top:8px; font-size:9px; line-height:12px; color:#9ca3af;">FILE</div>
                                <div style="margin:4px auto 0 auto; width:34px; background:#d93025; color:#ffffff; font-size:10px; line-height:16px; font-weight:bold; text-align:center; border-radius:2px;">PDF</div>
                              </td>
                            </tr>
                          </table>
                        </a>
                      </td>

                      <td style="padding:14px 4px 14px 8px; vertical-align:top; font-family:Arial, Helvetica, sans-serif; text-align:right;">
                        <a href="${safeLink}" target="_blank" style="font-size:14px; line-height:20px; color:#1a73e8; font-weight:bold; text-decoration:none;">
                          ${safeFileName}
                        </a>
                        <div style="font-size:12px; line-height:18px; color:#6b7280; margin-top:2px;">
                          Adobe Acrobat Document · ${safeFileSize}
                        </div>
                        <div style="font-size:11px; line-height:16px; color:#9ca3af; margin-top:5px;">
                          לחץ לפתיחה או הורדה של הקובץ
                        </div>
                      </td>

                      <td style="padding:14px 12px 14px 10px; width:34px; vertical-align:middle; text-align:center;">
                        <a href="${safeLink}" target="_blank" style="font-size:22px; line-height:22px; color:#9ca3af; text-decoration:none;">&#8964;</a>
                      </td>
                    </tr>

                    <tr>
                      <td colspan="3" style="padding:0 14px 14px 14px;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                          <tr>
                            <td bgcolor="#1a73e8" style="border-radius:6px;">
                              <a href="${safeLink}" target="_blank" style="display:inline-block; padding:10px 22px; font-family:Arial, Helvetica, sans-serif; font-size:13px; font-weight:bold; color:#ffffff; text-decoration:none; border-radius:6px;">
                                פתח קובץ PDF
                              </a>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <tr>
                <td style="padding:0 24px 24px 24px; font-family:Arial, Helvetica, sans-serif; color:#777777; text-align:right;">
                  <p style="margin:0; font-size:12px; line-height:1.6;">Paragon Group</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

function buildConfirmationEmailHtml(fullName) {
  const safeFullName = escapeHtml(fullName || "");

  return `
    <div dir="rtl" style="font-family:Arial, Helvetica, sans-serif; line-height:1.7; color:#202124; max-width:560px;">
      <h2 style="margin:0 0 12px 0; color:#111827;">
        שלום ${safeFullName} 👋
      </h2>

      <p style="font-size:16px; margin:0 0 14px 0;">
        נרשמת בהצלחה להרצאת הסייבר של <strong>Paragon</strong> 🔐
      </p>

      <p style="margin:0 0 14px 0;">
        מעולה, אתה בפנים. מבטיחים בלי מבחן בסוף, בלי שיעורי בית, ובלי שמישהו יבקש ממך את הסיסמה שלך 😉
      </p>

      <div style="background:#f8fafc; border:1px solid #e5e7eb; border-radius:12px; padding:16px 18px; margin:18px 0;">
        <p style="margin:0 0 10px 0; font-weight:bold; font-size:16px;">
          פרטי ההרצאה:
        </p>

        <ul style="padding-right:20px; margin:0; font-size:15px;">
          <li style="margin-bottom:6px;">📅 תאריך: <strong>16/06</strong></li>
          <li style="margin-bottom:6px;">⏰ שעה: <strong>14:30</strong></li>
          <li style="margin-bottom:6px;">💻 פלטפורמה: <strong>Zoom</strong></li>
        </ul>
      </div>

      <p style="margin:0 0 14px 0;">
        קישור לזום יישלח סמוך למועד ההרצאה.
      </p>

      <p style="margin:0 0 14px 0;">
        עד אז — לא לוחצים על קישורים חשודים, גם אם הם נראים ממש משכנעים 😄
      </p>

      <br>

      <p style="margin:0;">
        נתראה בהרצאה,<br>
        <strong>Paragon group</strong>
      </p>
    </div>
  `;
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
  return next();
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
  const token = String(req.query.u || "").trim();
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
  const fullName = String(req.body.full_name || "").trim();
  const company = String(req.body.company || "").trim();
  const phone = String(req.body.phone || "").trim();
  const email = normalizeEmail(req.body.email);
  const token = String(req.body.token || "").trim();
  const department = String(req.body.department || "").trim();

  if (!fullName || !email) {
    return res.status(400).send("חסר שם או אימייל");
  }

  if (!isValidEmail(email)) {
    return res.status(400).send("אימייל לא תקין");
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
        fullName,
        company,
        phone,
        email,
        token || null,
        ip,
        req.headers["user-agent"] || "",
        "submitted",
        department,
      ]
    );

    if (token) {
      await pool.query(
        `
        UPDATE clicks
        SET registered = true
        WHERE token = $1
        `,
        [token]
      );
    }

    await transporter.sendMail({
      from: mailFrom,
      to: email,
      subject: "אישור הרשמה להרצאת סייבר",
      html: buildConfirmationEmailHtml(fullName),
    });

    return res.sendFile(path.join(__dirname, "views", "success.html"));
  } catch (err) {
    console.error("REGISTER ERROR:", err.message);
    return res.status(500).send("שגיאה בהרשמה או בשליחת מייל");
  }
});

// =======================
// SEND TRACKING EMAILS
// =======================
async function sendTrackingEmails() {
  const employeesResult = await pool.query(
    `SELECT * FROM employees WHERE active = true ORDER BY created_at ASC`
  );

  const employees = employeesResult.rows;

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
    const link = `${BASE_URL}/?u=${encodeURIComponent(token)}`;

    try {
      await transporter.sendMail({
        from: mailFrom,
        to: emp.email,
        subject: settings.subject,
        html: buildPdfEmailHtml({
          employeeName: emp.name,
          intro: settings.intro,
          fileName: settings.file_name,
          fileSize: settings.file_size,
          link,
        }),
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
  const user = String(req.body.user || "");
  const password = String(req.body.password || "");

  if (user === process.env.ADMIN_USER && password === process.env.ADMIN_PASSWORD) {
    req.session.loggedIn = true;
    return res.redirect("/admin");
  }

  return res.status(401).send("פרטים שגויים");
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

  return res.redirect("/admin");
});

// =======================
// ADD EMPLOYEE
// =======================
app.post("/admin/add-employee", requireAdmin, async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = normalizeEmail(req.body.email);

  if (!name || !email || !isValidEmail(email)) {
    return res.redirect("/admin");
  }

  try {
    await pool.query(
      `
      INSERT INTO employees (name, email)
      VALUES ($1, $2)
      ON CONFLICT (email) DO NOTHING
      `,
      [name, email]
    );
  } catch (err) {
    console.error("ADD EMPLOYEE ERROR:", err.message);
  }

  return res.redirect("/admin");
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
      const name = String(row.name || row["שם"] || row.Name || "").trim();
      const email = normalizeEmail(row.email || row["מייל"] || row.Email || "");

      if (name && email && isValidEmail(email)) {
        const insertResult = await pool.query(
          `
          INSERT INTO employees (name, email)
          VALUES ($1, $2)
          ON CONFLICT (email) DO NOTHING
          RETURNING id
          `,
          [name, email]
        );

        if (insertResult.rowCount > 0) added++;
      }
    }

    console.log(`CSV imported: ${added} employees`);
  } catch (err) {
    console.error("CSV IMPORT ERROR:", err.message);
  }

  return res.redirect("/admin");
});

// =======================
// DELETE EMPLOYEE
// =======================
app.post("/admin/delete-employee", requireAdmin, async (req, res) => {
  const id = Number(req.body.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.redirect("/admin");
  }

  try {
    await pool.query(`DELETE FROM employees WHERE id = $1`, [id]);
  } catch (err) {
    console.error("DELETE EMPLOYEE ERROR:", err.message);
  }

  return res.redirect("/admin");
});

// =======================
// UPDATE MAIL SETTINGS
// =======================
app.post("/admin/mail-settings", requireAdmin, async (req, res) => {
  const subject = String(req.body.subject || "").trim();
  const intro = String(req.body.intro || "").trim();
  const fileName = String(req.body.file_name || "").trim();
  const fileSize = String(req.body.file_size || "").trim();

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
      [subject, intro, fileName, fileSize]
    );
  } catch (err) {
    console.error("MAIL SETTINGS ERROR:", err.message);
  }

  return res.redirect("/admin");
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

    const clicked = parseInt(totalClicks.rows[0].count, 10) || 0;
    const registered = parseInt(totalRegs.rows[0].count, 10) || 0;
    const total = parseInt(totalEmployees.rows[0].count, 10) || 0;
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
          <td>${escapeHtml(formatDate(r.created_at))}</td>
          <td>${escapeHtml(r.ip)}</td>
          <td>
            <form method="POST" action="/delete">
              <input type="hidden" name="id" value="${escapeAttr(r.id)}">
              <button type="submit" onclick="return confirm('למחוק נרשם זה?')">מחק</button>
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
          <td>${escapeHtml(formatDate(v.clicked_at))}</td>
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
              <input type="hidden" name="id" value="${escapeAttr(e.id)}">
              <button type="submit" onclick="return confirm('למחוק עובד זה?')">מחק</button>
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
              <div class="big-number">${clicked}</div>
              <div class="label">👆 לחיצות</div>
            </div>
            <div class="card">
              <div class="big-number">${registered}</div>
              <div class="label">✅ נרשמים</div>
            </div>
            <div class="card">
              <div class="big-number">${total}</div>
              <div class="label">👥 עובדים</div>
            </div>
          </div>

          <div class="top-bar">
            <a href="/logout" class="logout-btn">🚪 יציאה</a>

            <form method="POST" action="/admin/send-mails">
              <button type="submit" onclick="return confirm('בטוח לשלוח לכל העובדים?')">📤 שלח מיילים</button>
            </form>

            <form method="POST" action="/admin/reset-clicks" onsubmit="return confirm('בטוח לאפס את כל הקליקים?')">
              <button type="submit" class="reset-clicks-btn">איפוס קליקים ⚠️</button>
            </form>
          </div>

          <div class="tabs">
            <button type="button" class="tab-btn active" onclick="showTab('employees', this)">👥 עובדים (${total})</button>
            <button type="button" class="tab-btn" onclick="showTab('registrations', this)">✅ נרשמים (${registered})</button>
            <button type="button" class="tab-btn" onclick="showTab('clicks', this)">👆 קליקים (${clicked})</button>
            <button type="button" class="tab-btn" onclick="showTab('mails', this)">📤 מיילים</button>
            <button type="button" class="tab-btn" onclick="showTab('settings', this)">⚙️ הגדרות</button>
            <button type="button" class="tab-btn" onclick="showTab('stats', this)">📊 גרף</button>
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
            <p id="mailStatusText">מצב: ${mailJob.running ? "רץ עכשיו 🟡" : "לא רץ ⚪"}</p>
            <p id="mailCountsText">סך הכל: ${mailJob.total} | נשלחו: ${mailJob.sent} | נכשלו: ${mailJob.failed}</p>

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
              <input type="text" name="subject" value="${escapeAttr(settings.subject)}" required>

              <label>תוכן המייל - פתיח</label>
              <input type="text" name="intro" value="${escapeAttr(settings.intro)}" required>

              <label>שם הקובץ</label>
              <input type="text" name="file_name" value="${escapeAttr(settings.file_name)}" required>

              <label>גודל הקובץ</label>
              <input type="text" name="file_size" value="${escapeAttr(settings.file_size)}" required>

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
            document.querySelectorAll(".tab-content").forEach(function(el) {
              el.classList.remove("active");
            });

            document.querySelectorAll(".tab-btn").forEach(function(el) {
              el.classList.remove("active");
            });

            var tab = document.getElementById("tab-" + name);
            if (tab) tab.classList.add("active");
            if (btn) btn.classList.add("active");

            localStorage.setItem("activeTab", name);
          }

          function restoreSavedTab() {
            var savedTab = localStorage.getItem("activeTab");
            if (!savedTab) return;

            var tabEl = document.getElementById("tab-" + savedTab);
            if (!tabEl) return;

            document.querySelectorAll(".tab-content").forEach(function(el) {
              el.classList.remove("active");
            });

            document.querySelectorAll(".tab-btn").forEach(function(el) {
              el.classList.remove("active");
            });

            tabEl.classList.add("active");

            document.querySelectorAll(".tab-btn").forEach(function(btn) {
              var clickValue = btn.getAttribute("onclick") || "";
              if (clickValue.indexOf("'" + savedTab + "'") !== -1) {
                btn.classList.add("active");
              }
            });
          }

          function searchTable() {
            var inputEl = document.getElementById("search");
            if (!inputEl) return;

            var input = inputEl.value.toLowerCase();
            var rows = document.querySelectorAll("#reg-table tr");

            rows.forEach(function(row, i) {
              if (i === 0) return;
              row.style.display = row.innerText.toLowerCase().indexOf(input) !== -1 ? "" : "none";
            });
          }

          function safeText(value) {
            return value == null ? "" : String(value);
          }

          async function updateMailStatus() {
            try {
              var res = await fetch("/admin/mail-status");
              if (!res.ok) {
                setTimeout(updateMailStatus, 3000);
                return;
              }

              var data = await res.json();

              var statusText = document.getElementById("mailStatusText");
              var countsText = document.getElementById("mailCountsText");

              if (statusText) {
                statusText.textContent = "מצב: " + (data.running ? "רץ עכשיו 🟡" : "לא רץ ⚪");
              }

              if (countsText) {
                countsText.textContent =
                  "סך הכל: " + safeText(data.total) +
                  " | נשלחו: " + safeText(data.sent) +
                  " | נכשלו: " + safeText(data.failed);
              }

              var table = document.getElementById("mailJobTable");
              if (!table || !Array.isArray(data.results)) {
                setTimeout(updateMailStatus, 2000);
                return;
              }

              table.innerHTML = "";

              data.results.forEach(function(r) {
                var status = safeText(r.status);
                var color = status === "נשלח" ? "#22c55e" : status === "בתהליך" ? "#f59e0b" : "#ef4444";
                var icon = status === "נשלח" ? "✅" : status === "בתהליך" ? "⏳" : "❌";

                var tr = document.createElement("tr");

                var tdName = document.createElement("td");
                tdName.textContent = safeText(r.name);

                var tdEmail = document.createElement("td");
                tdEmail.textContent = safeText(r.email);

                var tdStatus = document.createElement("td");
                tdStatus.style.color = color;
                tdStatus.style.fontWeight = "bold";
                tdStatus.textContent = icon + " " + status;

                var tdError = document.createElement("td");
                if (r.error) tdError.style.color = "#ef4444";
                tdError.textContent = safeText(r.error);

                tr.appendChild(tdName);
                tr.appendChild(tdEmail);
                tr.appendChild(tdStatus);
                tr.appendChild(tdError);

                table.appendChild(tr);
              });

              setTimeout(updateMailStatus, data.running ? 2000 : 6000);
            } catch (err) {
              setTimeout(updateMailStatus, 3000);
            }
          }

          function initChart() {
            var canvas = document.getElementById("statsChart");
            if (!canvas || typeof Chart === "undefined") return;

            var ctx = canvas.getContext("2d");

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
          }

          restoreSavedTab();
          updateMailStatus();
          initChart();
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    console.error("ADMIN ERROR:", err.message);
    return res.status(500).send("שגיאה בטעינת אדמין");
  }
});

// =======================
// RESET CLICKS
// =======================
app.post("/admin/reset-clicks", requireAdmin, async (req, res) => {
  try {
    await pool.query("TRUNCATE clicks RESTART IDENTITY");
  } catch (err) {
    console.error("RESET CLICKS ERROR:", err.message);
  }

  return res.redirect("/admin");
});

// =======================
// DELETE REGISTRATION
// =======================
app.post("/delete", requireAdmin, async (req, res) => {
  const id = Number(req.body.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.redirect("/admin");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const deleted = await client.query(
      "DELETE FROM registrations WHERE id = $1 RETURNING token",
      [id]
    );

    const token = deleted.rows[0]?.token || null;

    if (token) {
      const remaining = await client.query(
        "SELECT 1 FROM registrations WHERE token = $1 LIMIT 1",
        [token]
      );

      await client.query(
        "UPDATE clicks SET registered = $1 WHERE token = $2",
        [remaining.rowCount > 0, token]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("DELETE REGISTRATION ERROR:", err.message);
  } finally {
    client.release();
  }

  return res.redirect("/admin");
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