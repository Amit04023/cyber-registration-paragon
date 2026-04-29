const express = require("express");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const port = 3000;

app.use(express.urlencoded({ extended: true }));

const db = new sqlite3.Database("registrations.db");

db.run(`
CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  company TEXT,
  phone TEXT,
  email TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
        input, button { width:100%; padding:12px; margin:8px 0; }
        button { background:#111; color:white; border:0; cursor:pointer; }
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

app.post("/register", (req, res) => {
  const { full_name, company, phone, email } = req.body;

  db.run(
    `INSERT INTO registrations (full_name, company, phone, email)
     VALUES (?, ?, ?, ?)`,
    [full_name, company, phone, email],
    () => {
      res.send(`
        <html dir="rtl" lang="he">
        <meta charset="UTF-8">
        <h2>תודה, ההרשמה נקלטה ✅</h2>
        <p>נתראה בהרצאה.</p>
        </html>
      `);
    }
  );
});

app.get("/admin", (req, res) => {
  db.all(`SELECT * FROM registrations ORDER BY created_at DESC`, [], (err, rows) => {
    let html = `<html dir="rtl"><meta charset="UTF-8"><h2>נרשמים</h2><table border="1" cellpadding="8">
    <tr><th>שם</th><th>חברה</th><th>טלפון</th><th>אימייל</th><th>תאריך</th></tr>`;

    rows.forEach(r => {
      html += `<tr>
        <td>${r.full_name}</td>
        <td>${r.company || ""}</td>
        <td>${r.phone || ""}</td>
        <td>${r.email}</td>
        <td>${r.created_at}</td>
      </tr>`;
    });

    html += `</table></html>`;
    res.send(html);
  });
});

const port = process.env.PORT || 3000;

app.listen(port, "0.0.0.0", () => {
  console.log(`Server running on port ${port}`);
});
