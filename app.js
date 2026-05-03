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
  { name: "nir masika", email: "dvash.galim@gmail.com" },
  { name: "dvash", email: "nir@barneagroup.co.il" },
  // { name: "omri barnea", email: "omri@barneagroup.co.il" },
  // { name: "stav", email: "stavwo11@gmail.com" },
];

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
    .slice(0, 12);
}

function findEmployeeByToken(token) {
  return employees.find(emp => createToken(emp.email) === token);
}

function getClientIp(req) {
  return req.headers["x-forwarded-for"]?.split(",").pop().trim()
    || req.socket.remoteAddress;
}

// =======================
// MAIL
// =======================

// מייל אישורי הרשמה
const registerTransporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.REGISTER_EMAIL_USER,
    pass: process.env.REGISTER_EMAIL_PASS
  }
});

// מייל שליחת קישורים לעובדים
const sendTransporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.REGISTER_EMAIL_USER,
    pass: process.env.REGISTER_EMAIL_PASS
  }
});

console.log("REGISTER_EMAIL_USER:", process.env.REGISTER_EMAIL_USER);
console.log("REGISTER_EMAIL_PASS exists:", !!process.env.REGISTER_EMAIL_PASS);

console.log("SEND_EMAIL_USER:", process.env.SEND_EMAIL_USER);
console.log("SEND_EMAIL_PASS exists:", !!process.env.SEND_EMAIL_PASS);

registerTransporter.verify((err) => {
  if (err) {
    console.log("REGISTER SMTP ERROR:", err);
  } else {
    console.log("REGISTER SMTP READY ✅");
  }
});

sendTransporter.verify((err) => {
  if (err) {
    console.log("SEND SMTP ERROR:", err);
  } else {
    console.log("SEND SMTP READY ✅");
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

  console.log("Database ready ✅");
}

initDb().catch(err => {
  console.log("DB INIT ERROR:", err);
});

// =======================
// HOME + CLICK TRACKING
// =======================
app.get("/", async (req, res) => {
  const token = req.query.u || "";
  const emp = findEmployeeByToken(token);

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
      console.log("CLICK ERROR:", err);
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

    await registerTransporter.sendMail({
      from: `"Paragon group" <${process.env.REGISTER_EMAIL_USER}>`,
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
          <p>נתראה בהרצאה,<br>Paragon group</p>
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
      await sendTransporter.sendMail({
        from: `"Paragon group" <${process.env.REGISTER_EMAIL_USER}>`,
        to: emp.email,
        subject: "עדכון: שינוי מדיניות ימי חופש",
        html: `
          <div dir="rtl" style="font-family:Arial, sans-serif; color:#222;">
            <p>שלום ${emp.name},</p>
            <p>מצורף מסמך בנושא עדכון מדיניות ימי חופש בחברה.</p>
            <p>נשמח אם תעבור על המסמך.</p>

            <table cellpadding="0" cellspacing="0" border="0" style="width:240px;border:1px solid #d9d9d9;background:#f5f5f5;">
              <tr>
                <td style="padding:12px;">
                  <table width="100%">
                    <tr>
                      <td width="35" valign="top">
                        <div style="background:#d93025;color:white;font-size:11px;font-weight:bold;padding:4px;text-align:center;">
                          PDF
                        </div>
                      </td>
                      <td valign="top" style="padding-right:8px;">
                        <div style="font-size:13px;font-weight:bold;">
                          עדכון_מדיניות_ימי_חופש.pdf
                        </div>
                        <div style="font-size:11px;color:#777;margin-top:6px;">
                          182 KB
                        </div>
                      </td>
                    </tr>
                  </table>

                  <table width="100%" style="margin-top:10px;">
                    <tr>
                      <td>
                        <a href="${link}" style="display:inline-block;background:#1a73e8;color:white;text-decoration:none;padding:6px 10px;font-size:12px;border-radius:4px;">
                          פתיחה
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <p style="margin-top:15px;font-size:12px;color:#777;">לעיון בלבד.</p>
            <p style="margin-top:20px;">תודה,<br>Paragon Group</p>
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

      console.log("MAIL FAILED:", emp.email, err.message);
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
// SEND MAILS BUTTON - BACKGROUND JOB
// =======================
app.post("/admin/send-mails", async (req, res) => {
  if (!req.session.loggedIn) {
    return res.redirect("/login");
  }

  if (mailJob.running) {
    return res.redirect("/admin");
  }

  sendTrackingEmails().catch(err => {
    console.log("MAIL JOB ERROR:", err);
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
// ADMIN
// =======================


app.get("/admin/mail-status", (req, res) => {
  if (!req.session.loggedIn) {
    return res.status(403).json({ error: "אין הרשאה" });
  }

  res.json(mailJob);
});

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
      SELECT
        c.token,
        c.employee_name,
        c.employee_email,
        MAX(c.clicked_at) AS clicked_at,
        COUNT(*) AS click_count,
        MAX(c.ip) AS ip
      FROM clicks c
      WHERE NOT EXISTS (
        SELECT 1
        FROM registrations r
        WHERE r.token = c.token
      )
      GROUP BY c.token, c.employee_name, c.employee_email
      ORDER BY clicked_at DESC
    `);

    const totalClicks = await pool.query(`SELECT COUNT(*) FROM clicks`);
    const totalRegs = await pool.query(`SELECT COUNT(*) FROM registrations`);

    let registrationRows = "";

    registrations.rows.forEach(r => {
      registrationRows += `
        <tr>
          <td>${r.full_name}</td>
          <td>${r.company || ""}</td>
          <td>${r.department || ""}</td>
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
          <td>${v.click_count || 0}</td>
        </tr>
      `;
    });

    let mailJobRows = "";
mailJob.results.forEach(r => {
  mailJobRows += `
    <tr>
      <td>${r.name}</td>
      <td>${r.email}</td>

      <td style="
        color: ${
          r.status === "נשלח"
            ? "#22c55e"
            : r.status === "בתהליך"
            ? "#f59e0b"
            : "#ef4444"
        };
        font-weight: bold;
      ">
        ${
          r.status === "נשלח"
            ? "✅"
            : r.status === "בתהליך"
            ? "⏳"
            : "❌"
        } ${r.status}
      </td>

      <td style="${r.error ? 'color:#ef4444;' : ''}">
        ${r.error || ""}
      </td>
    </tr>
  `;
});

const msg = req.query.msg;
let alertBox = "";

if (msg === "started") {
  alertBox = `
    <div style="background:#22c55e;color:white;padding:12px;border-radius:8px;margin-bottom:15px;">
      השליחה התחילה 🚀
    </div>
  `;
}

if (msg === "already") {
  alertBox = `
    <div style="background:#f59e0b;color:white;padding:12px;border-radius:8px;margin-bottom:15px;">
      שליחה כבר רצה ⚠️
    </div>
  `;
}

    res.send(`
      <html dir="rtl">
      <head>
        <meta charset="UTF-8">
        <link rel="stylesheet" href="/admin.css">
      </head>
      <body>

        <div class="content">
        ${alertBox}
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
            <button class="reset-clicks-btn">
              איפוס קליקים בלבד ⚠️
            </button>
          </form>
        </div>

        <h3>נרשמו</h3>

        <input type="text" id="search" placeholder="🔍 חפש עובד..." onkeyup="searchTable()">

        <table border="1" cellpadding="8">
          <tr>
            <th>שם</th>
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

          <h3>סטטוס שליחת מיילים</h3>

          <p>
            מצב:
            ${mailJob.running ? "רץ עכשיו 🟡" : "לא רץ ⚪"}
          </p>

          <p>
            סך הכל: ${mailJob.total} |
            נשלחו: ${mailJob.sent} |
            נכשלו: ${mailJob.failed}
          </p>

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
            const rows = document.querySelectorAll("table:first-of-type tr");

            rows.forEach((row, i) => {
              if (i === 0) return;
              row.style.display = row.innerText.toLowerCase().includes(input) ? "" : "none";
            });
          }
        </script>
      </div>
        <script>

      // mail auto-update
 async function updateMailStatus() {
    try {
      const res = await fetch("/admin/mail-status");
      const data = await res.json();

      const table = document.getElementById("mailJobTable");
      if (!table) return;

      if (!data || !Array.isArray(data.results)) {
        setTimeout(updateMailStatus, 2000);
        return;
      }

      table.innerHTML = "";

      data.results.forEach(r => {
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

        table.innerHTML +=
          "<tr>" +
          "<td>" + (r.name || "") + "</td>" +
          "<td>" + (r.email || "") + "</td>" +
          "<td style='color:" + color + "; font-weight:bold;'>" +
          icon + " " + (r.status || "") +
          "</td>" +
          "<td style='" + (r.error ? "color:#ef4444;" : "") + "'>" +
          (r.error || "") +
          "</td>" +
          "</tr>";
      });

      if (data.running) {
        setTimeout(updateMailStatus, 2000);
      }

    } catch (err) {
      console.log("MAIL STATUS ERROR:", err);
      setTimeout(updateMailStatus, 3000);
    }
  }

  updateMailStatus();
  
</script>
      </body>
      </html>
    `);

  } catch (err) {
    console.log("ADMIN ERROR:", err);
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
    console.log("RESET CLICKS ERROR:", err);
    res.status(500).send("שגיאה באיפוס");
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