/* Sfera olografica 3D di Cicciopasticcio */
(function () {
  function rng(seed) {
    let s = seed;
    return function () { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  }
  const ANIMS = ['cpRX', 'cpRY', 'cpRD1', 'cpRD2'];
  const COLS = ['#BFE0FF', '#8CC3FF', '#5AA2FF', '#3B82F6', '#E6F3FF'];

  function el(tag, cls, style) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (style) e.setAttribute('style', style);
    return e;
  }

  function build(scene) {
    scene.innerHTML = '';
    const S = scene.getBoundingClientRect().width || 380;
    const scale = Math.max(0.6, S / 380);
    const small = S < 300;

    // anelli concentrici su 4 assi
    const rr = rng(3);
    const nRings = small ? 16 : 22;
    for (let i = 0; i < nRings; i++) {
      const q = i / nRings;
      let inset, base;
      if (q < 0.6) { inset = 0.5 + rr() * 5; base = 10 + rr() * 25; }
      else if (q < 0.85) { inset = 10 + rr() * 18; base = 6 + rr() * 14; }
      else { inset = 34 + rr() * 6; base = 3 + rr() * 4; }
      const al = 0.22 + rr() * 0.45;
      const c = `rgba(140,195,255,${al.toFixed(2)})`;
      const br = `rgba(214,236,255,${Math.min(1, al + 0.4).toFixed(2)})`;
      const u = rr();
      const bw = [1, 1, 1.5, 2, 2.5][Math.floor(rr() * 5)];
      const bs = ['solid', 'solid', 'solid', 'dashed', 'dotted'][Math.floor(rr() * 5)];
      const top = u < 0.3 ? 'transparent' : (u < 0.7 ? br : c);
      const left = rr() < 0.3 ? 'transparent' : c;
      const glow = rr() < 0.45 ? 'box-shadow:0 0 10px rgba(59,130,246,.5);' : '';
      const dir = rr() < 0.5 ? 'normal' : 'reverse';
      const dot = rr() < 0.4;
      const tx = rr() * 180, ty = rr() * 180;
      const wrap = el('span', 'ring-wrap', `inset:${inset.toFixed(1)}%;transform:rotateX(${tx.toFixed(1)}deg) rotateY(${ty.toFixed(1)}deg);`);
      const ring = el('span', 'ring', `border:${bw}px ${bs} ${c};border-top-color:${top};border-left-color:${left};${glow}animation-name:${ANIMS[i % 4]};animation-direction:${dir};--dur:${base.toFixed(1)}s;`);
      if (dot) ring.appendChild(el('span', 'orbit-dot'));
      wrap.appendChild(ring);
      scene.appendChild(wrap);
    }

    // gusci di frammenti di luce
    function shell(n, seed, R, anim, dur, dir) {
      const r = rng(seed);
      const sh = el('span', 'shell', `animation-name:${anim};animation-direction:${dir};--dur:${dur}s;`);
      for (let i = 0; i < n; i++) {
        const w = (3 + r() * 16) * scale, h = r() < 0.8 ? 1.5 : 2.5;
        const lo = r() * 360, la = Math.asin(2 * r() - 1) * 180 / Math.PI;
        const z = R * (0.97 + r() * 0.06);
        const rz = (r() < 0.6 ? 0 : 90) + (r() - 0.5) * 24;
        const col = COLS[Math.floor(r() * COLS.length)];
        sh.appendChild(el('span', 'frag',
          `width:${w.toFixed(1)}px;height:${h}px;margin:${-h / 2}px 0 0 ${(-w / 2).toFixed(1)}px;background:${col};box-shadow:0 0 6px ${col};` +
          `transform:rotateY(${lo.toFixed(1)}deg) rotateX(${la.toFixed(1)}deg) translateZ(${z.toFixed(1)}px) rotateZ(${rz.toFixed(1)}deg);animation-delay:${(r() * 2.6).toFixed(2)}s;`));
      }
      scene.appendChild(sh);
    }
    shell(small ? 110 : 170, 7, S * 0.47, 'cpRY', 36, 'normal');
    shell(small ? 50 : 80, 9, S * 0.36, 'cpRD1', 24, 'reverse');

    // pannelli "dati"
    const rp = rng(21);
    const ps = el('span', 'shell', 'animation-name:cpRX;--dur:48s;');
    for (let i = 0; i < (small ? 6 : 8); i++) {
      const w = (14 + rp() * 22) * scale, h = (10 + rp() * 16) * scale;
      const lo = rp() * 360, la = Math.asin(2 * rp() - 1) * 180 / Math.PI;
      ps.appendChild(el('span', 'panel3d',
        `width:${w.toFixed(1)}px;height:${h.toFixed(1)}px;margin:${(-h / 2).toFixed(1)}px 0 0 ${(-w / 2).toFixed(1)}px;` +
        `transform:rotateY(${lo.toFixed(1)}deg) rotateX(${la.toFixed(1)}deg) translateZ(${(S * 0.27).toFixed(1)}px);`));
    }
    scene.appendChild(ps);

    // fasci di luce
    const rb = rng(5);
    const L = S * 0.48;
    for (let i = 0; i < (small ? 7 : 10); i++) {
      const wide = rb() < 0.3;
      const h = wide ? 4 + rb() * 4 : 1 + rb() * 1.5;
      const col = wide ? 'rgba(90,162,255,.35)' : ['rgba(140,195,255,.85)', 'rgba(90,162,255,.75)', 'rgba(214,236,255,.9)'][Math.floor(rb() * 3)];
      const az = rb() * 360, ay = rb() * 360, len = L * (0.6 + rb() * 0.4);
      const base = 4 + rb() * 10, dir = rb() < 0.5 ? 'normal' : 'reverse';
      const wrap = el('span', 'beam-wrap', `animation-name:${ANIMS[i % 4]};animation-direction:${dir};--dur:${base.toFixed(1)}s;`);
      wrap.appendChild(el('span', 'beam',
        `width:${len.toFixed(1)}px;height:${h.toFixed(1)}px;margin-top:${(-h / 2).toFixed(2)}px;transform:rotateZ(${az.toFixed(1)}deg) rotateY(${ay.toFixed(1)}deg);` +
        `background:linear-gradient(90deg, rgba(140,195,255,0) 0%, rgba(140,195,255,0) 20%, ${col} 75%, rgba(230,243,255,.95) 100%);box-shadow:0 0 8px ${col};`));
      scene.appendChild(wrap);
    }
  }

  window.CiccioSphere = {
    init(scene) {
      build(scene);
      let t;
      let lastW = scene.getBoundingClientRect().width;
      window.addEventListener('resize', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const w = scene.getBoundingClientRect().width;
          if (Math.abs(w - lastW) > 40) { lastW = w; build(scene); }
        }, 300);
      });
    },
    speed(k) { document.documentElement.style.setProperty('--k', String(k)); },
  };
})();
