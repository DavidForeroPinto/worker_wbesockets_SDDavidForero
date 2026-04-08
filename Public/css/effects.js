(() => {
  const canvas = document.getElementById("fxCanvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const cursorAura = document.getElementById("cursorAura");

  let width = window.innerWidth;
  let height = window.innerHeight;
  let mouseX = width / 2;
  let mouseY = height / 2;
  let targetX = mouseX;
  let targetY = mouseY;
  let animationId = null;

  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  const particles = Array.from({ length: 52 }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    r: Math.random() * 1.8 + 0.4,
    vx: (Math.random() - 0.5) * 0.18,
    vy: (Math.random() - 0.5) * 0.18,
    alpha: Math.random() * 0.55 + 0.12,
  }));

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;

    canvas.width = width * DPR;
    canvas.height = height * DPR;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function drawBackgroundPulse(time) {
    const t = time * 0.001;

    const g1 = ctx.createRadialGradient(
      width * 0.25 + Math.sin(t * 0.5) * 40,
      height * 0.22,
      0,
      width * 0.25,
      height * 0.22,
      280
    );
    g1.addColorStop(0, "rgba(80, 255, 245, 0.06)");
    g1.addColorStop(1, "rgba(80, 255, 245, 0)");

    const g2 = ctx.createRadialGradient(
      width * 0.78 + Math.cos(t * 0.4) * 55,
      height * 0.18,
      0,
      width * 0.78,
      height * 0.18,
      240
    );
    g2.addColorStop(0, "rgba(24, 190, 210, 0.05)");
    g2.addColorStop(1, "rgba(24, 190, 210, 0)");

    const g3 = ctx.createRadialGradient(
      width * 0.55,
      height * 0.88 + Math.sin(t * 0.35) * 30,
      0,
      width * 0.55,
      height * 0.88,
      320
    );
    g3.addColorStop(0, "rgba(90, 255, 210, 0.035)");
    g3.addColorStop(1, "rgba(90, 255, 210, 0)");

    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = g3;
    ctx.fillRect(0, 0, width, height);
  }

  function drawParticles() {
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;

      if (p.x < -10) p.x = width + 10;
      if (p.x > width + 10) p.x = -10;
      if (p.y < -10) p.y = height + 10;
      if (p.y > height + 10) p.y = -10;

      const dx = p.x - mouseX;
      const dy = p.y - mouseY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let alpha = p.alpha;
      if (dist < 160) alpha += (160 - dist) / 1600;

      ctx.beginPath();
      ctx.fillStyle = `rgba(110, 255, 250, ${alpha})`;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawConnections() {
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i];
        const b = particles[j];

        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 120) {
          const alpha = (1 - dist / 120) * 0.12;
          ctx.beginPath();
          ctx.strokeStyle = `rgba(90, 246, 255, ${alpha})`;
          ctx.lineWidth = 1;
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
  }

  function drawWaveLines(time) {
    const t = time * 0.0015;
    const lines = 5;

    for (let l = 0; l < lines; l++) {
      ctx.beginPath();
      const baseY = height * (0.68 + l * 0.035);

      for (let x = 0; x <= width; x += 12) {
        const y =
          baseY +
          Math.sin(x * 0.012 + t + l) * 10 +
          Math.cos(x * 0.006 + t * 1.4 + l * 0.4) * 8;

        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      ctx.strokeStyle = `rgba(70, 245, 255, ${0.05 + l * 0.012})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  function animate(time) {
    ctx.clearRect(0, 0, width, height);

    mouseX += (targetX - mouseX) * 0.06;
    mouseY += (targetY - mouseY) * 0.06;

    drawBackgroundPulse(time);
    drawWaveLines(time);
    drawConnections();
    drawParticles();

    animationId = requestAnimationFrame(animate);
  }

  window.addEventListener("resize", resize);

  window.addEventListener("mousemove", (e) => {
    targetX = e.clientX;
    targetY = e.clientY;

    if (cursorAura) {
      cursorAura.style.opacity = "1";
      cursorAura.style.left = `${e.clientX}px`;
      cursorAura.style.top = `${e.clientY}px`;
    }
  });

  window.addEventListener("mouseleave", () => {
    if (cursorAura) cursorAura.style.opacity = "0";
  });

  resize();
  animate(0);

  window.addEventListener("beforeunload", () => {
    if (animationId) cancelAnimationFrame(animationId);
  });
})();