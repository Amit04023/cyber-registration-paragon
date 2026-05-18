const express = require("express");
const nodemailer = require("nodemailer");
const { Pool } = require("pg");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const path = require("path");
const crypto = require("crypto");

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const BASE_URL = "https://cyber-registration-paragon.onrender.com";

// =======================
// ESCAPE HTML
// =======================
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// =======================
// DATABASE
// =======================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
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
  finishedAt: null
};

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createToken(email) {
  return crypto
    .createHash("sha256")
    .update(email.toLowerCase().trim())
    .digest("hex")
    .slice(0, 32);
}

function getClientIp(req) {
  return req.headers["x-forwarded-for"]?.split(",").pop().trim()
    || req.socket.remoteAddress;
}

// =======================
// MAIL
// =======================
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.REGISTER_EMAIL_USER,
    pass: process.env.REGISTER_EMAIL_PASS
  }
});

console.log("REGISTER_EMAIL_USER:", process.env.REGISTER_EMAIL_USER);
console.log("REGISTER_EMAIL_PASS exists:", !!process.env.REGISTER_EMAIL_PASS);

transporter.verify((err) => {
  if (err) {
    console.error("SMTP ERROR:", err);
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
  store: new pgSession({
    pool: pool,
    tableName: "session",
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || "dev-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    maxAge: 1000 * 60 * 60 * 24
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

  // =======================
  // טבלת עובדים חדשה
  // =======================
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employees (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("Database ready ✅");
}

initDb().catch(err => {
  console.error("DB INIT ERROR:", err);
});

// =======================
// HOME + CLICK TRACKING
// =======================
app.get("/", async (req, res) => {
  const token = req.query.u || "";

  // מחפש עובד לפי טוקן מה-DB
  let emp = null;
  if (token) {
    try {
      const result = await pool.query(
        `SELECT * FROM employees WHERE active = true`,
      );
      emp = result.rows.find(e => createToken(e.email) === token);
    } catch (err) {
      console.error("FIND EMPLOYEE ERROR:", err);
    }
  }

  if (token) {
    try {
      const ip = getClientIp(req);

      const alreadyClicked = await pool.query(
        "SELECT 1 FROM clicks WHERE token = $1 AND ip = $2 LIMIT 1",
        [token, ip]
      );

      if (alreadyClicked.rowCount === 0) {
        await pool.query(`
          INSERT INTO clicks (token, employee_name, employee_email, ip, user_agent)
          VALUES ($1, $2, $3, $4, $5)
        `, [
          token,
          emp ? emp.name : "Unknown",
          emp ? emp.email : "Unknown",
          ip,
          req.headers["user-agent"]
        ]);

        console.log("Click saved:", emp ? emp.email : token);
      } else {
        console.log("Click already exists:", emp ? emp.email : token);
      }

    } catch (err) {
      console.error("CLICK ERROR:", err);
    }
  }

  res.render("index", {
    name: emp ? emp.name : "משתמש",
    token
  });
});

// =======================
// REGISTER
// =======================
app.post("/register", async (req, res) => {
  const { full_name, company, phone, email, token, department } = req.body;

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
        company,
        phone,
        email,
        token || null,
        ip,
        req.headers["user-agent"],
        "submitted",
        department
      ]
    );

    if (token) {
      await pool.query(
        `UPDATE clicks SET registered = true WHERE token = $1`,
        [token]
      );
    }

    await transporter.sendMail({
      from: `"Paragon group" <${process.env.REGISTER_EMAIL_USER}>`,
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
      `
    });

    console.log("Registration email sent to:", email);

    res.sendFile(path.join(__dirname, "views", "success.html"));

  } catch (err) {
    console.error("REGISTER ERROR:", err);
    res.status(500).send("שגיאה בהרשמה או בשליחת מייל");
  }
});

// =======================
// SEND TRACKING EMAILS
// =======================
async function sendTrackingEmails() {
  // שולף עובדים מה-DB
  const result = await pool.query(
    `SELECT * FROM employees WHERE active = true ORDER BY created_at ASC`
  );
  const employees = result.rows;

  mailJob = {
    running: true,
    total: employees.length,
    sent: 0,
    failed: 0,
    results: [],
    startedAt: new Date(),
    finishedAt: null
  };

  for (const emp of employees) {
    const token = createToken(emp.email);
    const link = `${BASE_URL}/?u=${token}`;

    try {
      await transporter.sendMail({
        from: `"Paragon group" <${process.env.REGISTER_EMAIL_USER}>`,
        to: emp.email,
        subject: "עדכון: שינוי מדיניות ימי חופש",
        html: `
          <div dir="rtl" style="
            font-family: Arial, sans-serif;
            color: #222;
            line-height: 1.7;
          ">
            <p>שלום ${escapeHtml(emp.name)},</p>
            <p>פורסם עדכון בנושא מדיניות ימי חופש לעובדי החברה.</p>
            <p>לצפייה במסמך:</p>
            <a href="${link}" style="
              display:block;
              width:290px;
              border:1px solid #dadce0;
              border-radius:10px;
              background:#fff;
              text-decoration:none;
              overflow:hidden;
              color:#202124;
              box-shadow:0 1px 3px rgba(0,0,0,0.12);
            ">
              <div style="
                background:#f1f3f4;
                padding:18px;
                border-bottom:1px solid #e5e7eb;
              ">
                <img src="${BASE_URL}/pdf.png" style="
                  width:15px;
                  height:auto;
                  display:block;
                  margin-bottom:6px;
                  border-radius:5px;
                ">
                <div style="
                  font-size:15px;
                  font-weight:bold;
                  margin-bottom:6px;
                ">
                  עדכון מדיניות ימי חופש 2026
                </div>
              </div>
              <div style="
                padding:14px 18px;
                background:#fff;
              ">
                <span style="
                  display:inline-block;
                  background:#1a73e8;
                  color:#fff;
                  padding:8px 16px;
                  border-radius:6px;
                  font-size:13px;
                  font-weight:bold;
                ">
                  פתיחת המסמך
                </span>
              </div>
            </a>
            <p style="margin-top:20px; font-size:12px; color:#777;">
              Paragon Group
            </p>
          </div>
        `
      });

      mailJob.sent++;
      mailJob.results.push({
        name: emp.name,
        email: emp.email,
        status: "נשלח",
        error: ""
      });

      console.log("MAIL SENT:", emp.email);

    } catch (err) {
      mailJob.failed++;
      mailJob.results.push({
        name: emp.name,
        email: emp.email,
        status: "נכשל",
        error: err.message
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
app.post("/admin/send-mails", async (req, res) => {
  if (!req.session.loggedIn) {
    return res.redirect("/login");
  }

  if (mailJob.running) {
    return res.redirect("/admin");
  }

  sendTrackingEmails().catch(err => {
    console.error("MAIL JOB ERROR:", err);
    mailJob.running = false;
    mailJob.finishedAt = new Date();
    mailJob.results.push({
      name: "SYSTEM",
      email: "",
      status: "נכשל",
      error: err.message
    });
  });

  res.redirect("/admin");
});

// =======================
// ADD EMPLOYEE
// =======================
app.post("/admin/add-employee", async (req, res) => {
  if (!req.session.loggedIn) {
    return res.redirect("/login");
  }

  const { name, email } = req.body;

  if (!name || !email) {
    return res.redirect("/admin");
  }

  try {
    await pool.query(
      `INSERT INTO employees (name, email) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING`,
      [name, email]
    );
    console.log("Employee added:", email);
  } catch (err) {
    console.error("ADD EMPLOYEE ERROR:", err);
  }

  res.redirect("/admin");
});

// =======================
// DELETE EMPLOYEE
// =======================
app.post("/admin/delete-employee", async (req, res) => {
  if (!req.session.loggedIn) {
    return res.redirect("/login");
  }

  try {
    await pool.query(
      `DELETE FROM employees WHERE id = $1`,
      [req.body.id]
    );
    console.log("Employee deleted:", req.body.id);
  } catch (err) {
    console.error("DELETE EMPLOYEE ERROR:", err);
  }

  res.redirect("/admin");
});

// =======================
// ADMIN MAIL STATUS
// =======================
app.get("/admin/mail-status", (req, res) => {
  if (!req.session.loggedIn) {
    return res.status(403).json({ error: "אין הרשאה" });
  }

  res.json(mailJob);
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
      SELECT * FROM registrations ORDER BY created_at DESC
    `);

    const clickedNotRegistered = await pool.query(`
      SELECT
        c.token,
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

    const employees = await pool.query(`
      SELECT * FROM employees ORDER BY created_at DESC
    `);

    const totalClicks = await pool.query(`SELECT COUNT(*) FROM clicks`);
    const totalRegs = await pool.query(`SELECT COUNT(*) FROM registrations`);
    const totalEmployees = await pool.query(`SELECT COUNT(*) FROM employees WHERE active = true`);

    let registrationRows = "";
    registrations.rows.forEach(r => {
      registrationRows += `
        <tr>
          <td>${escapeHtml(r.full_name)}</td>
          <td>${escapeHtml(r.company)}</td>
          <td>${escapeHtml(r.department)}</td>
          <td>${escapeHtml(r.phone)}</td>
          <td>${escapeHtml(r.email)}</td>
          <td>${r.created_at}</td>
          <td>${escapeHtml(r.ip)}</td>
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
          <td>${escapeHtml(v.employee_name)}</td>
          <td>${escapeHtml(v.employee_email)}</td>
          <td>${v.clicked_at || ""}</td>
          <td>${escapeHtml(v.ip)}</td>
          <td>${v.click_count || 0}</td>
        </tr>
      `;
    });

    let employeeRows = "";
    employees.rows.forEach(e => {
      employeeRows += `
        <tr>
          <td>${escapeHtml(e.name)}</td>
          <td>${escapeHtml(e.email)}</td>
          <td>${e.active ? "✅" : "❌"}</td>
          <td>
            <form method="POST" action="/admin/delete-employee">
              <input type="hidden" name="id" value="${e.id}">
              <button onclick="return confirm('למחוק את ${escapeHtml(e.name)}?')" style="background:red;color:white;">מחק</button>
            </form>
          </td>
        </tr>
      `;
    });

    let mailJobRows = "";
    mailJob.results.forEach(r => {
      mailJobRows += `
        <tr>
          <td>${escapeHtml(r.name)}</td>
          <td>${escapeHtml(r.email)}</td>
          <td style="color: ${r.status === "נשלח" ? "#22c55e" : r.status === "בתהליך" ? "#f59e0b" : "#ef4444"}; font-weight: bold;">
            ${r.status === "נשלח" ? "✅" : r.status === "בתהליך" ? "⏳" : "❌"} ${r.status}
          </td>
          <td style="${r.error ? "color:#ef4444;" : ""}">
            ${escapeHtml(r.error)}
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
              <button type="submit" onclick="return confirm('בטוח לשלוח לכל העובדים?')">
                📤 שלח מיילים לעובדים
              </button>
            </form>
            <form method="POST" action="/admin/reset-clicks"
                onsubmit="return confirm('בטוח לאפס רק את הקליקים?')">
              <button class="reset-clicks-btn">איפוס קליקים בלבד ⚠️</button>
            </form>
          </div>

          <!-- עובדים -->
          <h3>👥 ניהול עובדים</h3>

          <form method="POST" action="/admin/add-employee" class="add-employee-form">
            <input type="text" name="name" placeholder="שם עובד" required style="padding:10px;border-radius:8px;border:none;background:#1e293b;color:white;">
            <input type="email" name="email" placeholder="מייל עובד" required style="padding:10px;border-radius:8px;border:none;background:#1e293b;color:white;width:250px;">
            <button type="submit">➕ הוסף עובד</button>
          </form>

          <table border="1" cellpadding="8">
            <tr>
              <th>שם</th>
              <th>מייל</th>
              <th>פעיל</th>
              <th>פעולות</th>
            </tr>
            ${employeeRows}
          </table>

          <!-- נרשמו -->
          <h3>נרשמו</h3>
          <input type="text" id="search" placeholder="🔍 חפש עובד..." onkeyup="searchTable()">
          <table border="1" cellpadding="8">
            <tr>
              <th>שם</th>
              <th>חברה</th>
              <th>מחלקה</th>
              <th>טלפון</th>
              <th>אימייל</th>
              <th>תאריך</th>
              <th>IP</th>
              <th>סטטוס</th>
              <th>פעולות</th>
            </tr>
            ${registrationRows}
          </table>

          <!-- לחצו ולא נרשמו -->
          <h3>לחצו על הקישור אבל לא נרשמו</h3>
          <table border="1" cellpadding="8">
            <tr>
              <th>שם עובד</th>
              <th>מייל</th>
              <th>זמן לחיצה אחרון</th>
              <th>IP</th>
              <th>כמות לחיצות</th>
            </tr>
            ${clickRows}
          </table>

          <!-- סטטוס שליחה -->
          <h3>סטטוס שליחת מיילים</h3>
          <p>מצב: ${mailJob.running ? "רץ עכשיו 🟡" : "לא רץ ⚪"}</p>
          <p>סך הכל: ${mailJob.total} | נשלחו: ${mailJob.sent} | נכשלו: ${mailJob.failed}</p>
          <table border="1" cellpadding="8">
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

          <script>
            function searchTable() {
              const input = document.getElementById("search").value.toLowerCase();
              const rows = document.querySelectorAll("table tr");
              rows.forEach((row, i) => {
                if (i === 0) return;
                row.style.display = row.innerText.toLowerCase().includes(input) ? "" : "none";
              });
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
                  const color = r.status === "נשלח" ? "#22c55e" : r.status === "בתהליך" ? "#f59e0b" : "#ef4444";
                  const icon = r.status === "נשלח" ? "✅" : r.status === "בתהליך" ? "⏳" : "❌";
                  table.innerHTML +=
                    "<tr>" +
                    "<td>" + (r.name || "") + "</td>" +
                    "<td>" + (r.email || "") + "</td>" +
                    "<td style='color:" + color + "; font-weight:bold;'>" + icon + " " + (r.status || "") + "</td>" +
                    "<td style='" + (r.error ? "color:#ef4444;" : "") + "'>" + (r.error || "") + "</td>" +
                    "</tr>";
                });
                if (data.running) setTimeout(updateMailStatus, 2000);
              } catch (err) {
                console.error("MAIL STATUS ERROR:", err);
                setTimeout(updateMailStatus, 3000);
              }
            }
            updateMailStatus();
          </script>
        </div>
      </body>
      </html>
    `);

  } catch (err) {
    console.error("ADMIN ERROR:", err);
    res.status(500).send("שגיאה בטעינת אדמין");
  }
});

// =======================
// CLICK RESET
// =======================
app.post("/admin/reset-clicks", async (req, res) => {
  if (!req.session.loggedIn) {
    return res.status(403).send("אין הרשאה");
  }

  try {
    await pool.query("TRUNCATE clicks RESTART IDENTITY");
    console.log("CLICKS RESET");
    res.redirect("/admin");
  } catch (err) {
    console.error("RESET CLICKS ERROR:", err);
    res.status(500).send("שגיאה באיפוס");
  }
});

// =======================
// DELETE REGISTRATION
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
    console.error("DELETE ERROR:", err);
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
  console.log("✅ Server running on port " + port);
});