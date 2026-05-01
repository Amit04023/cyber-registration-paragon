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