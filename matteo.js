/* Matteo — pannello con la scrivania animata dell'agente resi e supporto */
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Illustrazione: Matteo con le cuffie alla scrivania, portatile, stampante di etichette, pacchi dei resi.
  const SCENA = `
<svg class="mt-svg" viewBox="0 0 320 178" role="img" aria-labelledby="mt-titolo">
  <title id="mt-titolo">Matteo alla scrivania</title>
  <defs>
    <radialGradient id="mt-luce" cx="50%" cy="40%" r="60%">
      <stop offset="0" stop-color="#8CC3FF" stop-opacity=".9"/>
      <stop offset="1" stop-color="#8CC3FF" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="mt-pav" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0E2250"/><stop offset="1" stop-color="#081634"/>
    </linearGradient>
  </defs>

  <!-- pavimento -->
  <rect x="0" y="150" width="320" height="28" fill="url(#mt-pav)"/>

  <!-- orologio -->
  <g transform="translate(46 38)">
    <circle r="15" fill="#0B1C42" stroke="#2A4A8A" stroke-width="2"/>
    <g fill="#5A86D6"><circle cx="0" cy="-11" r="1.2"/><circle cx="11" cy="0" r="1.2"/><circle cx="0" cy="11" r="1.2"/><circle cx="-11" cy="0" r="1.2"/></g>
    <line class="mt-lancetta-h" x1="0" y1="0" x2="0" y2="-6.5" stroke="#C9D8F5" stroke-width="2.2" stroke-linecap="round"/>
    <line class="mt-lancetta-m" x1="0" y1="0" x2="0" y2="-10" stroke="#8CC3FF" stroke-width="1.6" stroke-linecap="round"/>
    <circle r="1.8" fill="#E8F0FF"/>
  </g>

  <!-- mensola con i pacchi dei resi -->
  <rect x="222" y="62" width="82" height="5" rx="2" fill="#2A4A8A"/>
  <g>
    <rect x="228" y="38" width="30" height="24" rx="2" fill="#B98552"/>
    <rect x="241" y="38" width="4" height="24" fill="#D9A877"/>
    <rect x="231" y="44" width="9" height="7" rx="1" fill="#F4F7FF"/>
    <rect x="262" y="30" width="36" height="32" rx="2" fill="#A97646"/>
    <rect x="278" y="30" width="4" height="32" fill="#D0A06F"/>
    <rect x="265" y="37" width="11" height="8" rx="1" fill="#F4F7FF"/>
    <g stroke="#0B1C42" stroke-width=".7"><line x1="267" y1="39" x2="267" y2="43"/><line x1="269" y1="39" x2="269" y2="43"/><line x1="270.5" y1="39" x2="270.5" y2="43"/><line x1="272.5" y1="39" x2="272.5" y2="43"/><line x1="274" y1="39" x2="274" y2="43"/></g>
  </g>

  <!-- pianta -->
  <g transform="translate(22 118)">
    <path d="M10 2 C2 -12 -4 -14 -6 -20 C2 -18 8 -12 10 2Z" fill="#2F9E6E"/>
    <path d="M12 2 C14 -14 22 -20 28 -22 C26 -12 20 -4 12 2Z" fill="#37B37D"/>
    <path d="M11 2 C8 -10 10 -22 14 -30 C17 -20 15 -8 11 2Z" fill="#2A8C62"/>
    <path d="M0 2 H22 L19 32 H3 Z" fill="#13295A" stroke="#2A4A8A" stroke-width="1.5"/>
  </g>

  <!-- sedia -->
  <rect x="126" y="62" width="68" height="64" rx="16" fill="#12254F" stroke="#1E3A75" stroke-width="2"/>

  <!-- Matteo -->
  <g class="mt-persona">
    <!-- busto: polo bianca -->
    <rect x="130" y="92" width="60" height="40" rx="18" fill="#F3F3EF"/>
    <rect x="130" y="92" width="60" height="40" rx="18" fill="none" stroke="#D9DCE3" stroke-width="1"/>
    <rect x="156" y="84" width="8" height="10" rx="3" fill="#E4AE86"/>
    <path d="M150 90 L160 101 L170 90 Z" fill="#E4AE86"/>
    <path d="M147 89 L160 101 L154 104 L145 93 Z" fill="#FFFFFF" stroke="#D9DCE3" stroke-width=".8"/>
    <path d="M173 89 L160 101 L166 104 L175 93 Z" fill="#FFFFFF" stroke="#D9DCE3" stroke-width=".8"/>
    <line x1="160" y1="101" x2="160" y2="112" stroke="#D9DCE3" stroke-width="1"/>
    <circle cx="160" cy="105" r=".9" fill="#C9CDD6"/><circle cx="160" cy="109" r=".9" fill="#C9CDD6"/>
    <!-- braccia -->
    <rect class="mt-braccio mt-braccio-sx" x="128" y="98" width="14" height="28" rx="7" fill="#E6E7E2"/>
    <rect class="mt-braccio mt-braccio-dx" x="178" y="98" width="14" height="28" rx="7" fill="#E6E7E2"/>

    <g class="mt-testa">
      <!-- orecchie (con orecchino) -->
      <ellipse cx="142" cy="70" rx="4" ry="5" fill="#E4AE86"/>
      <ellipse cx="178" cy="70" rx="4" ry="5" fill="#E4AE86"/>
      <circle cx="141.5" cy="74" r="1.3" fill="#F4F7FF"/>
      <path d="M139.5 66 C138 34 182 34 180.5 66" fill="none" stroke="#0B1C42" stroke-width="3" stroke-linecap="round"/>
      <!-- viso -->
      <ellipse cx="160" cy="69" rx="17.5" ry="20" fill="#EDBB94"/>
      <path d="M146 78 Q160 92 174 78" fill="none" stroke="#D99B73" stroke-width="1" opacity=".5"/>
      <!-- capelli: ciuffo voluminoso con la riga in mezzo che scende sulla fronte -->
      <path d="M139 70 C133 52 142 37 160 37 C178 37 187 52 181 70 C179.5 65 177.5 61 175.5 58.5 C173 62.5 168 62.5 164 58.5 C162 55.5 160.8 52.5 160 50 C159.2 52.5 158 55.5 156 58.5 C152 62.5 147 62.5 144.5 58.5 C142.5 61 140.5 65 139 70Z" fill="#76533A"/>
      <path d="M160 50 C157 55 152 60 146.5 60 C149 54 154 50.5 160 50Z" fill="#9A7350"/>
      <path d="M160 50 C163 55 168 60 173.5 60 C171 54 166 50.5 160 50Z" fill="#9A7350"/>
      <path d="M147 44 C153 40.5 167 40.5 173 44" fill="none" stroke="#A47C57" stroke-width="1.3" stroke-linecap="round"/>
      <path d="M143 52 C145 47 149 44 153 43" fill="none" stroke="#A47C57" stroke-width="1" stroke-linecap="round" opacity=".7"/>
      <!-- sopracciglia -->
      <path d="M149 63.5 Q153 62 157 63.3" fill="none" stroke="#4A3322" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M163 63.3 Q167 62 171 63.5" fill="none" stroke="#4A3322" stroke-width="1.6" stroke-linecap="round"/>
      <!-- occhi aperti: azzurri -->
      <g class="mt-occhi">
        <ellipse cx="153" cy="68" rx="2.6" ry="2.4" fill="#FFFFFF"/>
        <ellipse cx="167" cy="68" rx="2.6" ry="2.4" fill="#FFFFFF"/>
        <circle cx="153" cy="68" r="1.6" fill="#6F9BC4"/>
        <circle cx="167" cy="68" r="1.6" fill="#6F9BC4"/>
        <circle cx="153" cy="68" r=".7" fill="#1A1430"/>
        <circle cx="167" cy="68" r=".7" fill="#1A1430"/>
      </g>
      <!-- occhi chiusi (pausa) -->
      <g class="mt-chiusi" fill="none" stroke="#4A3322" stroke-width="1.5" stroke-linecap="round">
        <path d="M150.5 69 Q153 71 155.5 69"/><path d="M164.5 69 Q167 71 169.5 69"/>
      </g>
      <!-- naso e bocca -->
      <path d="M160 69 L158.6 75 Q160 76 161.4 75" fill="none" stroke="#C98763" stroke-width="1" stroke-linecap="round"/>
      <path class="mt-bocca" d="M156 79.5 Q160 81.5 164 79.5" fill="none" stroke="#B5655A" stroke-width="1.6" stroke-linecap="round"/>
      <!-- cuffie -->
      <rect x="135.5" y="63" width="7" height="13" rx="3.5" fill="#0B1C42"/>
      <rect x="177.5" y="63" width="7" height="13" rx="3.5" fill="#0B1C42"/>
      <path d="M140 75 C141 83 147 85 152 83" fill="none" stroke="#0B1C42" stroke-width="2" stroke-linecap="round"/>
      <circle cx="153" cy="83" r="2.2" fill="#3B82F6"/>
    </g>

    <!-- zzz -->
    <g class="mt-zzz" fill="#C9D8F5" font-family="Inter, sans-serif" font-weight="600">
      <text x="186" y="52" font-size="11">z</text>
      <text x="194" y="40" font-size="14">z</text>
      <text x="204" y="26" font-size="17">Z</text>
    </g>
  </g>

  <!-- luce del portatile sul viso -->
  <ellipse class="mt-luce" cx="160" cy="84" rx="34" ry="26" fill="url(#mt-luce)"/>

  <!-- scrivania -->
  <rect x="34" y="122" width="252" height="9" rx="3" fill="#2A4A8A"/>
  <rect x="46" y="131" width="228" height="22" rx="2" fill="#1A3366"/>
  <rect x="52" y="153" width="8" height="14" fill="#1A3366"/>
  <rect x="260" y="153" width="8" height="14" fill="#1A3366"/>

  <!-- portatile (visto da dietro) -->
  <rect x="129" y="103" width="62" height="20" rx="3" fill="#3A4D78"/>
  <rect x="129" y="103" width="62" height="20" rx="3" fill="none" stroke="#5A6F9C" stroke-width="1.2"/>
  <circle cx="160" cy="113" r="5.8" fill="none" stroke="#C9D8F5" stroke-width="1.3"/>
  <text x="160" y="116.2" text-anchor="middle" font-family="'Bodoni Moda', Georgia, serif" font-size="8" fill="#E8F0FF">D</text>
  <rect x="122" y="120" width="76" height="3" rx="1.5" fill="#5A6F9C"/>

  <!-- stampante di etichette -->
  <g transform="translate(70 100)">
    <rect class="mt-etichetta" x="7" y="-3" width="18" height="16" rx="1" fill="#F4F7FF"/>
    <g class="mt-etichetta" stroke="#0B1C42" stroke-width=".8"><line x1="10" y1="1" x2="10" y2="6"/><line x1="12" y1="1" x2="12" y2="6"/><line x1="13.5" y1="1" x2="13.5" y2="6"/><line x1="16" y1="1" x2="16" y2="6"/><line x1="18" y1="1" x2="18" y2="6"/><line x1="19.5" y1="1" x2="19.5" y2="6"/><line x1="22" y1="1" x2="22" y2="6"/></g>
    <rect x="0" y="6" width="32" height="17" rx="4" fill="#13295A" stroke="#2A4A8A" stroke-width="1.5"/>
    <rect x="5" y="5" width="22" height="3" rx="1.5" fill="#0B1C42"/>
    <circle class="mt-led" cx="26" cy="17" r="1.8" fill="#4ADE80"/>
  </g>

  <!-- tazza -->
  <g transform="translate(222 104)">
    <g class="mt-vapore" fill="none" stroke="#C9D8F5" stroke-width="1.5" stroke-linecap="round" opacity=".7">
      <path class="mt-v1" d="M6 -2 C3 -6 9 -9 6 -13"/>
      <path class="mt-v2" d="M12 -2 C9 -6 15 -9 12 -13"/>
    </g>
    <rect x="0" y="0" width="18" height="18" rx="3" fill="#E8F0FF"/>
    <path d="M18 4 C25 4 25 13 18 13" fill="none" stroke="#E8F0FF" stroke-width="2.5"/>
    <rect x="0" y="5" width="18" height="4" fill="#3B82F6"/>
  </g>

  <!-- pacco sulla scrivania -->
  <g transform="translate(246 100)">
    <rect x="0" y="0" width="28" height="22" rx="2" fill="#B98552"/>
    <rect x="12" y="0" width="4" height="22" fill="#D9A877"/>
    <rect x="3" y="5" width="8" height="6" rx="1" fill="#F4F7FF"/>
  </g>

  <!-- fumetto con le cose in attesa -->
  <g class="mt-bolla">
    <rect x="96" y="14" width="44" height="24" rx="12" fill="#FBBF24"/>
    <path d="M128 36 L136 46 L122 37 Z" fill="#FBBF24"/>
    <text class="mt-bolla-n" x="118" y="31" text-anchor="middle" font-family="Inter, sans-serif" font-size="13" font-weight="700" fill="#1A1430">!</text>
  </g>
</svg>`;

  const STATI = {
    attivo: ['Al lavoro', 'on'],
    pausa: ['In pausa', 'pausa'],
    spento: ['Spento', 'spento'],
  };

  function ora(ms) {
    return new Date(ms).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }
  function quando(iso) {
    const d = new Date(iso);
    const oggi = new Date().toDateString() === d.toDateString();
    return oggi ? ora(d) : d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  }

  const API = (window.CICCIO_MATTEO_API || '').replace(/\/$/, '');
  let ultimo = null;
  let dettagli = false;

  function token() {
    try { return JSON.parse(localStorage.getItem('ciccio_token') || 'null'); } catch (_) { return null; }
  }
  async function chiama(path, body) {
    const r = await fetch(`${API}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'x-ciccio-token': token() || '' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || `Errore ${r.status}`);
    return j;
  }

  function riga(r) {
    return `<div class="mt-riga"><span class="mt-ora">${esc(quando(r.quando))}</span><span class="mt-cosa"><b>${esc(r.ordine || r.cliente || '—')}</b> · ${esc(r.tipo)}</span><span class="mt-stato ${/fermato/i.test(r.stato) ? 'ko' : /attesa/i.test(r.stato) ? 'wait' : ''}">${esc(r.stato)}</span></div>`;
  }

  function render(panel, m) {
    const body = panel.querySelector('.body');
    const pill = panel.querySelector('.mt-pill');
    if (!m || m.error) {
      pill.textContent = '';
      pill.className = 'mt-pill';
      const msg = m && m.error === 'non collegato' ? 'Matteo non ancora collegato' : (m && m.error) || 'Nessun dato';
      body.outerHTML = `<div class="body"><div class="mt-scena mt-spento">${SCENA}</div><div class="off">${esc(msg)}</div></div>`;
      return;
    }
    const st = STATI[m.stato] || STATI.spento;
    const lavora = m.stato === 'attivo';
    const fermo = m.ultimo_giro && Date.now() - m.ultimo_giro > 20 * 60000;
    pill.textContent = m.prova && lavora ? 'In prova' : st[0];
    pill.className = `mt-pill ${st[1]}`;

    const classi = ['mt-scena', `mt-${m.stato}`];
    if (m.attesa > 0) classi.push('mt-avviso');

    const quante = dettagli ? 5 : 3;
    const blocchi = [];
    if (m.attesa > 0) blocchi.push(['Aspetta te', m.attesa_lista.slice(0, quante)]);
    if (m.attesa === 0 || dettagli) blocchi.push(['Ultime cose fatte', m.ultime.slice(0, quante)]);
    const liste = blocchi.map(([t, l]) => `<div class="mt-titolo-lista">${t}</div><div class="list">${l.length ? l.map(riga).join('') : '<div class="off">Ancora nessuna mail gestita</div>'}</div>`).join('');
    const bottone = m.stato === 'pausa'
      ? '<button class="mini-btn primary" data-mt="riprendi">Fallo ripartire</button>'
      : m.stato === 'attivo' ? '<button class="mini-btn" data-mt="pausa">Metti in pausa</button>' : '';

    body.outerHTML = `<div class="body">
      <button class="${classi.join(' ')}" data-mt="dettagli" aria-expanded="${dettagli}" aria-label="Mostra più dettagli su Matteo">${SCENA}</button>
      <div class="stats">
        <div class="stat"><b>${m.oggi ?? 0}</b><span>mail oggi</span></div>
        <div class="stat"><b class="${m.attesa > 0 ? 'mt-giallo' : ''}">${m.attesa ?? 0}</b><span>in attesa</span></div>
        <div class="stat"><b>${m.ultimo_giro ? ora(m.ultimo_giro) : '–'}</b><span>ultimo controllo</span></div>
      </div>
      ${liste}
      ${lavora && fermo ? '<div class="foot">Non controlla la casella da più di 20 minuti: guarda Apps Script.</div>' : ''}
      ${bottone ? `<div class="mt-azioni">${bottone}</div>` : ''}
    </div>`;
    const n = panel.querySelector('.mt-bolla-n');
    if (n) n.textContent = m.attesa > 9 ? '9+' : String(m.attesa || '!');
  }

  async function refresh() {
    const panel = document.getElementById('p-matteo');
    if (!panel || !API || !token()) return;
    try { ultimo = await chiama('/pannello'); } catch (e) { ultimo = { error: e.message }; }
    render(panel, ultimo);
  }

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-mt]');
    if (!b) return;
    const panel = document.getElementById('p-matteo');
    if (b.dataset.mt === 'dettagli') { dettagli = !dettagli; if (ultimo) render(panel, ultimo); return; }
    b.disabled = true;
    try { await chiama('/comando', { comando: b.dataset.mt }); } catch (err) { b.disabled = false; window.alert(`Matteo: ${err.message}`); return; }
    refresh();
  });

  setInterval(() => { if (!document.hidden) refresh(); }, 60000);

  window.CiccioMatteo = { render, refresh };
})();
