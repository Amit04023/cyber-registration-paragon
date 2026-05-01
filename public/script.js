const canvas = document.getElementById("matrix");

if (canvas) {
  const ctx = canvas.getContext("2d");

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  resizeCanvas();

  const letters = "01PARAGONCYBER";
  const fontSize = 15;
  let columns = Math.floor(canvas.width / fontSize);
  let drops = Array(columns).fill(1);

  function drawMatrix() {
    ctx.fillStyle = "rgba(0, 0, 0, 0.06)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#00ff88";
    ctx.font = fontSize + "px monospace";

    for (let i = 0; i < drops.length; i++) {
      const char = letters[Math.floor(Math.random() * letters.length)];
      ctx.fillText(char, i * fontSize, drops[i] * fontSize);

      if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
        drops[i] = 0;
      }

      drops[i]++;
    }
  }

  setInterval(drawMatrix, 33);

  window.addEventListener("resize", () => {
    resizeCanvas();
    columns = Math.floor(canvas.width / fontSize);
    drops = Array(columns).fill(1);
  });
}

const terminal = document.getElementById("terminalText");

if (terminal) {
  const lines = [
    "> מתחיל סריקת אבטחה...",
    "> בודק טביעת דפדפן...",
    "> מזהה פעילות חשודה...",
    "> סורק נקודות חשיפה...",
    "> רמת סיכון: גבוהה ⚠️",
    "> מומלץ להירשם להרצאת הסייבר של Paragon",
    "> מעביר אותך להרשמה..."
  ];

  let lineIndex = 0;

  function typeLine() {
    if (lineIndex >= lines.length) return;

    const div = document.createElement("div");
    div.textContent = lines[lineIndex];
    terminal.appendChild(div);

    lineIndex++;
    setTimeout(typeLine, 650);
  }

  typeLine();
}

const intro = document.getElementById("intro");
const formBox = document.getElementById("formBox");

if (intro && formBox) {
  setTimeout(() => {
    intro.style.display = "none";
    formBox.style.display = "block";
  }, 6500);
}





// ===== FIRE EFFECTS =====
const smokeCanvas = document.getElementById("smokeCanvas");
const embersCanvas = document.getElementById("embersCanvas");

if (smokeCanvas && embersCanvas) {
  const smokeCtx = smokeCanvas.getContext("2d");
  const embersCtx = embersCanvas.getContext("2d");

  let w, h;
  let smokeParticles = [];
  let emberParticles = [];

  function resizeFireEffects() {
    w = window.innerWidth;
    h = window.innerHeight;

    smokeCanvas.width = w;
    smokeCanvas.height = h;
    embersCanvas.width = w;
    embersCanvas.height = h;

    createFireParticles();
  }

  function createFireParticles() {
    smokeParticles = [];
    emberParticles = [];

    for (let i = 0; i < 90; i++) {
      smokeParticles.push({
        x: Math.random() * w,
        y: h * 0.35 + Math.random() * h,
        size: 70 + Math.random() * 170,
        speedY: 0.2 + Math.random() * 0.55,
        speedX: -0.4 + Math.random() * 0.8,
        alpha: 0.018 + Math.random() * 0.055,
        wobble: Math.random() * Math.PI * 2
      });
    }

    for (let i = 0; i < 160; i++) {
      emberParticles.push({
        x: Math.random() * w,
        y: h * 0.55 + Math.random() * h * 0.5,
        size: 1 + Math.random() * 4,
        speedY: 1.2 + Math.random() * 4,
        speedX: -3 + Math.random() * 6,
        alpha: 0.3 + Math.random() * 0.7,
        glow: 6 + Math.random() * 16
      });
    }
  }

  function drawSmoke() {
    smokeCtx.clearRect(0, 0, w, h);

    smokeParticles.forEach(p => {
      p.wobble += 0.01;
      p.x += p.speedX + Math.sin(p.wobble) * 0.25;
      p.y -= p.speedY;

      if (p.y < -p.size) {
        p.y = h + p.size;
        p.x = Math.random() * w;
      }

      const gradient = smokeCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
      gradient.addColorStop(0, `rgba(220,220,220,${p.alpha})`);
      gradient.addColorStop(0.45, `rgba(130,130,130,${p.alpha * 0.5})`);
      gradient.addColorStop(1, "rgba(0,0,0,0)");

      smokeCtx.fillStyle = gradient;
      smokeCtx.beginPath();
      smokeCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      smokeCtx.fill();
    });
  }

  function drawEmbers() {
    embersCtx.clearRect(0, 0, w, h);

    emberParticles.forEach(p => {
      p.x += p.speedX;
      p.y -= p.speedY;
      p.alpha *= 0.996;

      if (p.y < -20 || p.x < -20 || p.x > w + 20 || p.alpha < 0.08) {
        p.x = Math.random() * w;
        p.y = h * 0.65 + Math.random() * h * 0.35;
        p.alpha = 0.3 + Math.random() * 0.7;
        p.speedY = 1.2 + Math.random() * 4;
        p.speedX = -3 + Math.random() * 6;
      }

      embersCtx.shadowBlur = p.glow;
      embersCtx.shadowColor = "rgba(255,100,0,1)";
      embersCtx.fillStyle = `rgba(255,${90 + Math.random() * 120},20,${p.alpha})`;

      embersCtx.beginPath();
      embersCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      embersCtx.fill();
    });

    embersCtx.shadowBlur = 0;
  }

  function animateFireEffects() {
    drawSmoke();
    drawEmbers();
    requestAnimationFrame(animateFireEffects);
  }

  window.addEventListener("resize", resizeFireEffects);

  resizeFireEffects();
  animateFireEffects();
}