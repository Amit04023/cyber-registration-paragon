const express = require("express");
const nodemailer = require("nodemailer");
const { Pool } = require("pg");
const session = require("express-session");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

const TRACK_FILE = path.join(__dirname, "tracking.json");
const BASE_URL = "https://cyber-registration-paragon.onrender.com";

function loadTracking() {
  if (!fs.existsSync(TRACK_FILE)) return {};
  return JSON.parse(fs.readFileSync(TRACK_FILE, "utf8"));
}

function saveTracking(data) {
  fs.writeFileSync(TRACK_FILE, JSON.stringify(data, null, 2));
}

function createToken(email) {
  return crypto
    .createHash("sha256")
    .update(email.toLowerCase())
    .digest("hex")
    .slice(0, 12);
}

const employees = [
  { name: "amit masika", email: "amitomcar@gmail.com" },
  { name: "nir masika", email: "nir@barneagroup.co.il" }
];

function findEmployeeByToken(token) {
  return employees.find(emp => createToken(emp.email) === token);
}

// 📦 Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// 👇 מעקב קליקים לפי token
app.use(async (req, res, next) => {
  const token = req.query.u;

  if (token && req.method === "GET") {
    const emp = findEmployeeByToken(token);

    try {
      await pool.query(
        `INSERT INTO clicks (token, employee_name, employee_email, ip, user_agent)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          token,
          emp ? emp.name : "Unknown",
          emp ? emp.email : "Unknown",
          req.headers["x-forwarded-for"] || req.socket.remoteAddress,
          req.headers["user-agent"]
        ]
      );
    } catch (err) {
      console.log("Click tracking error:", err);
    }
  }

  next();
});

// 🗄️ Database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// 📩 מייל אישור הרשמה
const registerTransporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.REGISTER_EMAIL_USER,
    pass: process.env.REGISTER_EMAIL_PASS
  }
});

// 📤 מייל שליחת קישורים לעובדים
const sendTransporter = nodemailer.createTransport({
  host: "smtp.zoho.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.SEND_EMAIL_USER,
    pass: process.env.SEND_EMAIL_PASS
  }
});

// יצירת טבלה - הרשמות
pool.query(`
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

// יצירת טבלה - קליקים
pool.query(`
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

// 🏠 דף ראשי
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

// 📝 הרשמה
app.post("/register", async (req, res) => {
  const { full_name, company, phone, email, token } = req.body;

await pool.query(
  `INSERT INTO registrations 
   (full_name, company, phone, email, token, ip, user_agent, simulation_result)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
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

  try {
    await registerTransporter.sendMail({
      from: "Paragon Cyber <" + process.env.REGISTER_EMAIL_USER + ">",
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
          <p>קישור לזום יישלח אליך סמוך למועד ההרצאה.</p>
          <br>
          <p>נתראה בהרצאה,<br>משפחת Paragon</p>
        </div>
      `
    });
  } catch (err) {
    console.log("Register email error:", err);
  }

  res.sendFile(path.join(__dirname, "views", "success.html"));
});

// 📤 שליחת מייל ייחודי לכל עובד
async function sendTrackingEmails() {
  for (const emp of employees) {
    const token = createToken(emp.email);
    const link = `${BASE_URL}/?u=${token}`;

    await sendTransporter.sendMail({
     from: "Paragon IT <" + process.env.SEND_EMAIL_USER + ">",
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

    console.log(`Sent to ${emp.name} - ${emp.email} - ${link}`);
  }
}

// 🔐 LOGIN PAGE
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "login.html"));
});

// 🔐 LOGIN ACTION
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

// 📤 שליחה לכולם
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
    console.error("Send mails error:", err);
    res.status(500).send("שגיאה בשליחת מיילים");
  }
});

// 🔒 ADMIN
app.get("/admin", async (req, res) => {
  if (!req.session.loggedIn) {
    return res.redirect("/login");
  }

  const result = await pool.query(`SELECT * FROM registrations ORDER BY created_at DESC`);
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

  let rows = "";

  result.rows.forEach(r => {
    rows += `
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

  let clickedNotRegisteredRows = "";

 clickedNotRegistered.rows.forEach(v => {
  clickedNotRegisteredRows += `
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
      <table>
        <tr>
          <th>שם</th>
          <th>חברה</th>
          <th>טלפון</th>
          <th>אימייל</th>
          <th>תאריך</th>
          <th>פעולות</th>
          <th>IP</th>
          <th>סטטוס</th>
        </tr>
        ${rows}
      </table>

      <h3>לחצו על הקישור אבל לא נרשמו</h3>
      <table>
        <tr>
          <th>שם עובד</th>
          <th>מייל</th>
          <th>זמן לחיצה אחרון</th>
          <th>IP</th>
        </tr>
        ${clickedNotRegisteredRows}
      </table>
    </body>
    </html>
  `);
});

// ❌ DELETE
app.post("/delete", async (req, res) => {
  if (!req.session.loggedIn) {
    return res.redirect("/login");
  }

  const { id } = req.body;

  await pool.query(
    "DELETE FROM registrations WHERE id = $1",
    [id]
  );

  res.redirect("/admin");
});

// 🚪 LOGOUT
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

// 🚀 START SERVER
const port = process.env.PORT || 3000;

app.listen(port, "0.0.0.0", () => {
  console.log("Server running on port " + port);
});
