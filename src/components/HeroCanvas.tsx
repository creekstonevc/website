import { useEffect, useRef } from "react";

const LBLS = ["agent", "model", "tool", "plan", "exec", "RAG", "memory", "API", "loop", "infer", "ctx", "task", "RL", "MCP", "LLM", "ASI", "embed", "token", "call", "think"];
const PORTFOLIO = ["Youware", "Odysslife", "Kaleidoscope", "Verdent", "Mem-U", "Xmax", "Machine Pulse", "AirJelly", "RSI"];

// Direct port of the original site's interactive particle-network canvas,
// including the dwell-to-reveal portfolio name behavior.
export default function HeroCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const G = (a: number) => `rgba(201,168,76,${a})`;
    let W = 0, H = 0;
    let pts: P[] = [];
    let mx = -1, my = -1;
    const N = 95, DIST = 135;

    let nameState: "hidden" | "appearing" | "visible" | "fading" = "hidden";
    let nameAlpha = 0, showName: string | null = null, nameX = 0, nameY = 0;
    let dwellTimer: number | undefined, prevMx = -1, prevMy = -1;
    let raf = 0;

    function resize() {
      W = canvas!.width = canvas!.offsetWidth || window.innerWidth;
      H = canvas!.height = canvas!.offsetHeight || window.innerHeight;
    }
    const pick = () => PORTFOLIO[Math.floor(Math.random() * PORTFOLIO.length)];

    class P {
      hub: boolean;
      x = 0; y = 0; vx = 0; vy = 0; r = 0; a = 0;
      node = false; lbl = ""; t = 0; ps = 0;
      constructor(hub: boolean) { this.hub = hub; this.init(); }
      init() {
        this.x = Math.random() * W; this.y = Math.random() * H;
        this.vx = (Math.random() - 0.5) * (this.hub ? 0.32 : 0.78);
        this.vy = (Math.random() - 0.5) * (this.hub ? 0.32 : 0.78);
        this.r = this.hub ? 5 : Math.random() * 2 + 0.8;
        this.a = this.hub ? 0.75 : Math.random() * 0.48 + 0.2;
        this.node = this.hub || Math.random() < 0.14;
        this.lbl = LBLS[Math.floor(Math.random() * LBLS.length)];
        this.t = Math.random() * Math.PI * 2;
        this.ps = Math.random() * 0.055 + 0.016;
      }
      step() {
        this.t += this.ps;
        if (mx > 0) {
          const dx = mx - this.x, dy = my - this.y, d = Math.sqrt(dx * dx + dy * dy);
          const R = this.hub ? 300 : 220;
          if (d < R && d > 1) { const f = this.hub ? 1.2 : 0.9; this.x += (dx / d) * f; this.y += (dy / d) * f; }
        }
        this.x += this.vx; this.y += this.vy;
        if (this.x < -90 || this.x > W + 90 || this.y < -90 || this.y > H + 90) this.init();
      }
      near() { return mx > 0 && (mx - this.x) ** 2 + (my - this.y) ** 2 < 160 ** 2; }
      draw() {
        const c = ctx!;
        const pulse = 0.72 + 0.28 * Math.sin(this.t), boost = this.near() ? 2.2 : 1;
        if (this.hub) {
          const gr = c.createRadialGradient(this.x, this.y, 0, this.x, this.y, 22);
          gr.addColorStop(0, G(0.38 * pulse * boost)); gr.addColorStop(1, G(0));
          c.beginPath(); c.arc(this.x, this.y, 22, 0, Math.PI * 2); c.fillStyle = gr; c.fill();
          c.beginPath(); c.arc(this.x, this.y, this.r * pulse, 0, Math.PI * 2); c.fillStyle = G(this.a * pulse * boost); c.fill();
          if (this.near() && nameState === "hidden") { c.fillStyle = G(this.a * boost * 0.85); c.font = "9px Space Mono,monospace"; c.fillText(this.lbl, this.x + 8, this.y - 8); }
        } else if (this.node) {
          const s = 3.8;
          c.strokeStyle = G(this.a * pulse * boost); c.lineWidth = this.near() ? 1.2 : 0.65;
          c.strokeRect(this.x - s, this.y - s, s * 2, s * 2);
          c.fillStyle = G(this.a * 0.14 * boost); c.fillRect(this.x - s, this.y - s, s * 2, s * 2);
          if (nameState === "hidden") { c.fillStyle = G(this.a * pulse * boost); c.font = "8px Space Mono,monospace"; c.fillText(this.lbl, this.x + s + 4, this.y + 3); }
        } else {
          c.beginPath(); c.arc(this.x, this.y, this.r * (this.near() ? 1.7 : 1) * pulse, 0, Math.PI * 2);
          c.fillStyle = G(this.a * pulse * boost); c.fill();
        }
      }
    }

    function scheduleDwell() {
      window.clearTimeout(dwellTimer);
      dwellTimer = window.setTimeout(() => {
        if ((nameState === "hidden" || nameState === "fading") && mx > 0) {
          showName = pick(); nameX = mx; nameY = my; nameAlpha = 0; nameState = "appearing";
        }
      }, 700);
    }

    function drawName() {
      const c = ctx!;
      if (nameState === "appearing") { nameAlpha = Math.min(nameAlpha + 0.038, 1); if (nameAlpha >= 1) nameState = "visible"; }
      else if (nameState === "fading") { nameAlpha = Math.max(nameAlpha - 0.07, 0); if (nameAlpha <= 0) { nameAlpha = 0; nameState = "hidden"; showName = null; } }
      if (nameAlpha <= 0 || !showName) return;

      const a = nameAlpha, nx = nameX, ny = nameY - 44;
      c.save();
      const halo = c.createRadialGradient(nx, ny, 0, nx, ny, 68);
      halo.addColorStop(0, `rgba(180,200,224,${a * 0.07})`);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      c.beginPath(); c.arc(nx, ny, 68, 0, Math.PI * 2); c.fillStyle = halo; c.fill();
      const fs = Math.max(16, Math.min(21, W / 48));
      c.font = `300 ${fs}px Georgia,'Times New Roman',serif`;
      c.textAlign = "center"; c.textBaseline = "middle";
      c.fillStyle = `rgba(188,204,222,${a * 0.88})`;
      c.shadowColor = `rgba(150,175,205,${a * 0.2})`; c.shadowBlur = 10;
      c.fillText(showName, nx, ny);
      const tw = c.measureText(showName).width;
      c.shadowBlur = 0; c.strokeStyle = `rgba(188,204,222,${a * 0.18})`; c.lineWidth = 0.5;
      c.beginPath(); c.moveTo(nx - tw / 2, ny + fs * 0.65); c.lineTo(nx + tw / 2, ny + fs * 0.65); c.stroke();
      c.restore();
    }

    function init() {
      resize();
      pts = [];
      for (let i = 0; i < 6; i++) pts.push(new P(true));
      for (let i = 0; i < N; i++) pts.push(new P(false));
      scheduleDwell();
    }

    function frame() {
      const c = ctx!;
      c.clearRect(0, 0, W, H);
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y, d2 = dx * dx + dy * dy;
          if (d2 < DIST * DIST) {
            const d = Math.sqrt(d2);
            const hub = pts[i].hub || pts[j].hub ? 2.5 : 1;
            const a = (1 - d / DIST) * 0.3 * hub;
            c.beginPath(); c.moveTo(pts[i].x, pts[i].y); c.lineTo(pts[j].x, pts[j].y);
            c.strokeStyle = G(Math.min(a, 0.65)); c.lineWidth = pts[i].hub || pts[j].hub ? 1 : 0.55; c.stroke();
          }
        }
      }
      pts.forEach((p) => { p.step(); p.draw(); });
      drawName();
      raf = requestAnimationFrame(frame);
    }

    const onMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      const nx = e.clientX - r.left, ny = e.clientY - r.top;
      const moved = (nx - prevMx) ** 2 + (ny - prevMy) ** 2 > 12 ** 2;
      mx = nx; my = ny;
      if (moved) {
        prevMx = nx; prevMy = ny;
        if (nameState === "visible" || nameState === "appearing") nameState = "fading";
        scheduleDwell();
      }
    };
    const onLeave = () => {
      mx = -1; my = -1;
      window.clearTimeout(dwellTimer);
      if (nameState !== "hidden") nameState = "fading";
    };

    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);
    window.addEventListener("resize", init);
    init();
    frame();

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(dwellTimer);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("resize", init);
    };
  }, []);

  return <canvas id="heroCanvas" ref={ref} />;
}
