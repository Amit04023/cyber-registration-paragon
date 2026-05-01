// ===== FIRE EFFECTS ONLY =====

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

    // 💨 עשן
    for (let i = 0; i < 180; i++) {
      smokeParticles.push({
        x: Math.random() * w,
        y: h * 0.25 + Math.random() * h,
        size: 90 + Math.random() * 220,
        speedY: 0.18 + Math.random() * 0.45,
        speedX: -0.55 + Math.random() * 1.1,
        alpha: 0.035 + Math.random() * 0.075,
        wobble: Math.random() * Math.PI * 2,
        wobbleSpeed: 0.004 + Math.random() * 0.01
      });
    }

    // ✨ גיצים
    for (let i = 0; i < 420; i++) {
      emberParticles.push({
        x: Math.random() * w,
        y: h * 0.52 + Math.random() * h * 0.55,
        size: 1 + Math.random() * 4.5,
        speedY: 1.3 + Math.random() * 4.6,
        speedX: -3.5 + Math.random() * 7,
        alpha: 0.35 + Math.random() * 0.65,
        glow: 8 + Math.random() * 20
      });
    }
  }

  function drawSmoke() {
    smokeCtx.clearRect(0, 0, w, h);

    smokeParticles.forEach(p => {
      p.wobble += p.wobbleSpeed;
      p.x += p.speedX + Math.sin(p.wobble) * 0.35;
      p.y -= p.speedY;

      if (p.y < -p.size) {
        p.y = h + p.size;
        p.x = Math.random() * w;
      }

      if (p.x < -p.size) {
        p.x = w + p.size;
      }

      if (p.x > w + p.size) {
        p.x = -p.size;
      }

      const gradient = smokeCtx.createRadialGradient(
        p.x,
        p.y,
        0,
        p.x,
        p.y,
        p.size
      );

      gradient.addColorStop(0, `rgba(235, 235, 235, ${p.alpha})`);
      gradient.addColorStop(0.35, `rgba(170, 170, 170, ${p.alpha * 0.55})`);
      gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

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
      p.alpha *= 0.997;

      if (
        p.y < -20 ||
        p.x < -20 ||
        p.x > w + 20 ||
        p.alpha < 0.08
      ) {
        p.x = Math.random() * w;
        p.y = h * 0.62 + Math.random() * h * 0.42;
        p.size = 1 + Math.random() * 4.5;
        p.speedY = 1.3 + Math.random() * 4.6;
        p.speedX = -3.5 + Math.random() * 7;
        p.alpha = 0.35 + Math.random() * 0.65;
        p.glow = 8 + Math.random() * 20;
      }

      embersCtx.shadowBlur = p.glow;
      embersCtx.shadowColor = "rgba(255, 100, 0, 1)";
      embersCtx.fillStyle = `rgba(255, ${90 + Math.random() * 120}, 20, ${p.alpha})`;

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