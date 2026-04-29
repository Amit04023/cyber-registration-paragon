const express = require("express");
const { Pool } = require("pg");

const app = express();

app.use(express.urlencoded({ extended: true }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

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

app.get("/", (req, res) => {
  res.send(`
    <html dir="rtl" lang="he">
    <head>
      <meta charset="UTF-8">
      <title>הרשמה להרצאת סייבר</title>
      <style>
        body { font-family: Arial; background:#f4f4f4; }
        .box { max-width:400px; margin:60px auto; background:white; padding:25px; border-radius:12px; }
        input, button { width:100%; padding:12px; margin:8px 0; box-sizing:border-box; }
        button { background:#111; color:white; border:0; cursor:pointer; border-radius:6px; }
      </style>
    </head>
    <body>
      <div class="box">
        <h2>הרשמה להרצאת מודעות סייבר</h2>
        <form method="POST" action="/register">
          <input name="full_name" placeholder="שם מלא" required>
          <input name="company" placeholder="חברה / מחלקה">
          <input name="phone" placeholder="טלפון">
          <input name="email" type="email" placeholder="אימייל" required>
          <button type="submit">אישור הגעה</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

app.post("/register", async (req, res) => {
  const { full_name, company, phone, email } = req.body;

  await pool.query(
    `INSERT INTO registrations (full_name, company, phone, email)
     VALUES ($1, $2, $3, $4)`,
    [full_name, company, phone, email]
  );

  res.send(`
    <html dir="rtl">
    <meta charset="UTF-8">
    <h2>תודה, ההרשמה נקלטה ✅</h2>
    </html>
  `);
});

app.get("/admin", async (req, res) => {
  if (
    req.query.user !== process.env.ADMIN_USER ||
    req.query.password !== process.env.ADMIN_PASSWORD
  ) {
    return res.status(401).send(`
      <html dir="rtl">
      <meta charset="UTF-8">
      <h2>אין הרשאה</h2>
      <p>כניסה עם שם משתמש וסיסמה נדרשת.</p>
      </html>
    `);
  }

  const result = await pool.query(
    `SELECT * FROM registrations ORDER BY created_at DESC`
  );

  let html = `
  <html dir="rtl" lang="he">
  <head>
    <meta charset="UTF-8">
    <title>מערכת אדמין</title>
    <style>
      body { font-family: Arial; background:#f4f4f4; padding:30px; }
      .box { background:white; padding:25px; border-radius:12px; }
      table { width:100%; border-collapse:collapse; }
      th, td { border:1px solid #ddd; padding:10px; text-align:right; }
      th { background:#111; color:white; }
    </style>
  </head>
  <body>
    <div class="box">
      <h2>נרשמים להרצאה</h2>
      <p>סה״כ נרשמים: ${result.rows.length}</p>
      <table>
        <tr>
          <th>שם</th>
          <th>חברה</th>
          <th>טלפון</th>
          <th>אימייל</th>
          <th>תאריך</th>
        </tr>
  `;

  result.rows.forEach(r => {
    html += `
      <tr>
        <td>${r.full_name}</td>
        <td>${r.company || ""}</td>
        <td>${r.phone || ""}</td>
        <td>${r.email}</td>
        <td>${r.created_at}</td>
      </tr>
    `;
  });

  html += `
      </table>
    </div>
  </body>
  </html>`;

  res.send(html);
});

const port = process.env.PORT || 3000;

app.listen(port, "0.0.0.0", () => {
  console.log(`Server running on port ${port}`);
});
