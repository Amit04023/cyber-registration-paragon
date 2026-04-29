const express = require("express");
const nodemailer = require("nodemailer");
const { Pool } = require("pg");
const session = require("express-session");
const path = require("path");

const app = express();

// 📦 Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public")); // 👈 קבצי עיצוב ו־JS

app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// 🗄️ Database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
//  Mail
const transporter = require("nodemailer").createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});
// יצירת טבלה
pool.query(`
CREATE TABLE IF NOT EXISTS registrations (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  company TEXT,
  phone TEXT,
  email TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
`);

// 🏠 דף ראשי
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

// 📝 הרשמה
app.post("/register", async (req, res) => {
  const { full_name, company, phone, email } = req.body;

  await pool.query(
    `INSERT INTO registrations (full_name, company, phone, email)
     VALUES ($1, $2, $3, $4)`,
    [full_name, company, phone, email]
  );

  // 📧 שליחת מייל
  try {
    await transporter.sendMail({
      from: "Paragon Cyber <" + process.env.EMAIL_USER + ">",
      to: email,
      subject: "אישור הרשמה להרצאת סייבר",
      html: `
        <div dir="rtl" style="font-family:Arial">
          <h2>שלום ${full_name},</h2>
          <p>נרשמת בהצלחה להרצאת הסייבר של Paragon 🔐</p>
          <p>נתראה בהרצאה!</p>
        </div>
      `
    });
  } catch (err) {
    console.log("Email error:", err);
  }

  res.sendFile(path.join(__dirname, "views", "success.html"));
});

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

// 🔒 ADMIN
app.get("/admin", async (req, res) => {
  if (!req.session.loggedIn) {
    return res.redirect("/login");
  }

  const result = await pool.query(
    `SELECT * FROM registrations ORDER BY created_at DESC`
  );

  let rows = "";

  result.rows.forEach(r => {
    rows += `
      <tr>
        <td>${r.full_name}</td>
        <td>${r.company || ""}</td>
        <td>${r.phone || ""}</td>
        <td>${r.email}</td>
        <td>${r.created_at}</td>
        <td>
          <form method="POST" action="/delete">
            <input type="hidden" name="id" value="${r.id}">
            <button onclick="return confirm('אתה בטוח?')" style="background:red;color:white;">מחק</button>
          </form>
        </td>
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

      <table>
        <tr>
          <th>שם</th>
          <th>חברה</th>
          <th>טלפון</th>
          <th>אימייל</th>
          <th>תאריך</th>
          <th>פעולות</th>
        </tr>
        ${rows}
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
