const express = require("express");
const nodemailer = require("nodemailer");
const { Pool } = require("pg");
const session = require("express-session");
const path = require("path");
const crypto = require("crypto");

const app = express();

const BASE_URL = "https://cyber-registration-paragon.onrender.com";

// =======================
// DATABASE
// =======================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// =======================
// EMPLOYEES
// =======================
const employees = [
  { name: "amit masika", email: "amitomcar@gmail.com" },
  { name: "nir masika", email: "nir@barneagroup.co.il" }
];

function createToken(email) {
  return crypto
    .createHash("sha256")
    .update(email.toLowerCase().trim())
    .digest("hex")
    .slice(0, 12);
}

function findEmployeeByToken(token) {
  return employees.find(emp => createToken(emp.email) === token);
}

// =======================
// MAIL - Gmail בלבד
// =======================
const mailTransporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.REGISTER_EMAIL_USER,
    pass: process.env.REGISTER_EMAIL_PASS
  }
});

console.log("REGISTER_EMAIL_USER:", process.env.REGISTER_EMAIL_USER);
console.log("REGISTER_EMAIL_PASS exists:", !!process.env.REGISTER_EMAIL_PASS);

mailTransporter.verify((err) => {
  if (err) {
    console.log("SMTP ERROR:", err);
  } else {
    console.log("SMTP READY ✅");
  }
});

// =======================
// MIDDLEWARE
// =======================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false
  }
}));

// =======================
// INIT TABLES
// =======================
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS registrations (
      id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      company TEXT,
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

  console.log("Database ready ✅");
}

initDb().catch(err => {
  console.log("DB INIT ERROR:", err);
});

// =======================
// CLICK TRACKING
// =======================
app.use(async (req, res, next) => {
  const token = req.query.u;

  if (token && req.method === "GET") {
    const emp = findEmployeeByToken(token);

    try {
      await pool.query(
        `
        INSERT INTO clicks 
        (token, employee_name, employee_email, ip, user_agent)
        VALUES ($1, $2, $3, $4, $5)
        `,
        [
          token,
          emp ? emp.name : "Unknown",
          emp ? emp.email : "Unknown",
          req.headers["x-forwarded-for"] || req.socket.remoteAddress,
          req.headers["user-agent"]
        ]
      );

      console.log("Click saved:", emp ? emp.email : token);
    } catch (err) {
      console.log("CLICK TRACKING ERROR:", err);
    }
  }

  next();
});

// =======================
// HOME
// =======================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

// =======================
// REGISTER
// =======================
app.post("/register", async (req, res) => {
  const { full_name, company, phone, email, token } = req.body;

  try {
    await pool.query(
      `
      INSERT INTO registrations 
      (full_name, company, phone, email, token, ip, user_agent, simulation_result)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        full_name,
        company,
        phone,
        email,
        token || null,
        req.headers["x-forwarded-for"] || req.socket.remoteAddress,
        req.headers["user-agent"],
        "submitted"
      ]
    );

    if (token) {
      await pool.query(
        `UPDATE clicks SET registered = true WHERE token = $1`,
        [token]
      );
    }

    await mailTransporter.sendMail({
      from: `"Paragon Cyber" <${process.env.REGISTER_EMAIL_USER}>`,
      to: email,
      subject: "אישור הרשמה להרצאת סייבר",
      html: `
        <div dir="rtl" style="font-family:Arial; line-height:1.6">
          <h2>שלום ${full_name},</h2>
          <p>נרשמת בהצלחה להרצאת הסייבר של Paragon 🔐</p>
          <p><strong>פרטי ההרצאה:</strong></p>
          <ul style="padding-right:20px">
            <li>📅 תאריך: X</li>
            <li>⏰ שעה: X</li>
            <li>💻 פלטפורמה: Zoom</li>
          </ul>
          <p>קישור לזום יישלח סמוך למועד ההרצאה.</p>
          <br>
          <p>נתראה בהרצאה,<br>Paragon Cyber</p>
        </div>
      `
    });

    console.log("Registration email sent to:", email);

    res.sendFile(path.join(__dirname, "views", "success.html"));

  } catch (err) {
    console.log("REGISTER ERROR:", err);
    res.status(500).send("שגיאה בהרשמה או בשליחת מייל");
  }
});

// =======================
// SEND TRACKING EMAILS
// =======================
async function sendTrackingEmails() {
  for (const emp of employees) {
    const token = createToken(emp.email);
    const link = `${BASE_URL}/?u=${token}`;

    await mailTransporter.sendMail({
      from: `"Paragon IT" <${process.env.REGISTER_EMAIL_USER}>`,
      to: emp.email,
      subject: "השקת אתר חדש – בדיקה קצרה",
      html: `
        <div dir="rtl" style="font-family:Arial; line-height:1.6">
          <h2>שלום ${emp.name},</h2>

          <p>
            העלינו גרסה חדשה לאתר ונשמח לעזרתך בבדיקה קצרה.
          </p>

          <p>
            הפעולה אורכת פחות מדקה:
          </p>

          <p>
            👉 <a href="${link}" style="color:#2563eb;">כניסה לאתר</a>
          </p>

          <br>
          <p>Paragon IT</p>
        </div>
      `
    });

    console.log("Tracking email sent:", emp.email, link);
  }
}

// =======================
// LOGIN
// =======================
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "login.html"));
});

app.post("/login", (req, res) => {
  const { user, password } = req.body;

  if (
    user === process.env.ADMIN_USER &&
    password === process.env.ADMIN_PASSWORD
  ) {
    req.session.loggedIn = true;
    return res.redirect("/admin");
  }

  res.send("פרטים שגויים");
});

// =======================
// SEND MAILS BUTTON
// =======================
app.get("/admin/send-mails", async (req, res) => {
  if (!req.session.loggedIn) {
    return res.redirect("/login");
  }

  try {
    await sendTrackingEmails();

    res.send(`
      <html dir="rtl">
      <head><meta charset="UTF-8"></head>
      <body>
        <h2>המיילים נשלחו בהצלחה ✅</h2>
        <a href="/admin">חזרה לאדמין</a>
      </body>
      </html>
    `);
  } catch (err) {
    console.log("SEND MAILS ERROR:", err);
    res.status(500).send(`
      <html dir="rtl">
      <head><meta charset="UTF-8"></head>
      <body>
        <h2>שגיאה בשליחת מיילים ❌</h2>
        <pre>${err.message}</pre>
        <a href="/admin">חזרה לאדמין</a>
      </body>
      </html>
    `);
  }
});

// =======================
// ADMIN
// =======================
app.get("/admin", async (req, res) => {
  if (!req.session.loggedIn) {
    return res.redirect("/login");
  }

  try {
    const registrations = await pool.query(`
      SELECT * FROM registrations 
      ORDER BY created_at DESC
    `);

    const clickedNotRegistered = await pool.query(`
      SELECT DISTINCT ON (token)
        token,
        employee_name,
        employee_email,
        ip,
        user_agent,
        clicked_at
      FROM clicks
      WHERE registered = false
      ORDER BY token, clicked_at DESC
    `);

    let registrationRows = "";

    registrations.rows.forEach(r => {
      registrationRows += `
        <tr>
          <td>${r.full_name}</td>
          <td>${r.company || ""}</td>
          <td>${r.phone || ""}</td>
          <td>${r.email}</td>
          <td>${r.created_at}</td>
          <td>${r.ip || ""}</td>
          <td>מילא פרטים</td>
          <td>
            <form method="POST" action="/delete">
              <input type="hidden" name="id" value="${r.id}">
              <button onclick="return confirm('אתה בטוח?')" style="background:red;color:white;">מחק</button>
            </form>
          </td>
        </tr>
      `;
    });

    let clickRows = "";

    clickedNotRegistered.rows.forEach(v => {
      clickRows += `
        <tr>
          <td>${v.employee_name || ""}</td>
          <td>${v.employee_email || ""}</td>
          <td>${v.clicked_at || ""}</td>
          <td>${v.ip || ""}</td>
        </tr>
      `;
    });

    res.send(`
      <html dir="rtl">
      <head>
        <meta charset="UTF-8">
        <link rel="stylesheet" href="/admin.css">
      </head>
      <body>
        <h2>מערכת אדמין</h2>

        <a href="/logout">יציאה</a>
        |

        <form method="GET" action="/admin/send-mails" style="display:inline;">
          <button type="submit">📤 שלח מיילים לעובדים</button>
        </form>

        <h3>נרשמו</h3>
        <table border="1" cellpadding="8">
          <tr>
            <th>שם</th>
            <th>חברה</th>
            <th>טלפון</th>
            <th>אימייל</th>
            <th>תאריך</th>
            <th>IP</th>
            <th>סטטוס</th>
            <th>פעולות</th>
          </tr>
          ${registrationRows}
        </table>

        <h3>לחצו על הקישור אבל לא נרשמו</h3>
        <table border="1" cellpadding="8">
          <tr>
            <th>שם עובד</th>
            <th>מייל</th>
            <th>זמן לחיצה אחרון</th>
            <th>IP</th>
          </tr>
          ${clickRows}
        </table>
      </body>
      </html>
    `);

  } catch (err) {
    console.log("ADMIN ERROR:", err);
    res.status(500).send("שגיאה בטעינת אדמין");
  }
});

// =======================
// DELETE
// =======================
app.post("/delete", async (req, res) => {
  if (!req.session.loggedIn) {
    return res.redirect("/login");
  }

  try {
    await pool.query(
      "DELETE FROM registrations WHERE id = $1",
      [req.body.id]
    );

    res.redirect("/admin");
  } catch (err) {
    console.log("DELETE ERROR:", err);
    res.status(500).send("שגיאה במחיקה");
  }
});

// =======================
// LOGOUT
// =======================
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

// =======================
// START
// =======================
const port = process.env.PORT || 3000;

app.listen(port, "0.0.0.0", () => {
  console.log("Server running on port " + port);
});
