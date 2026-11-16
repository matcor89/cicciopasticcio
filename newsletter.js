/* Cicciopasticcio — newsletter pronta da copiare in Shopify Email */
(function () {
  let deps = null;
  let current = null;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function el() {
    let o = document.getElementById('nl');
    if (o) return o;
    o = document.createElement('div');
    o.id = 'nl';
    o.className = 'overlay hidden';
    o.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="nl-h"><div id="nl-body"></div></div>';
    o.addEventListener('click', (e) => {
      if (e.target === o) return close();
      const c = e.target.closest('[data-copy]');
      if (c) return copy(c.dataset.copy, c);
      if (e.target.closest('[data-nl-close]')) return close();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !o.classList.contains('hidden')) close(); });
    document.body.appendChild(o);
    return o;
  }

  async function copy(key, btn) {
    const text = textFor(key);
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const t = document.createElement('textarea');
      t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch (__) { /* ignore */ }
      t.remove();
    }
    const old = btn.textContent;
    btn.textContent = 'Copiato ✓';
    setTimeout(() => { btn.textContent = old; }, 1400);
  }

  function textFor(key) {
    const n = current || {};
    if (key.startsWith('p:')) { const p = (n.products || [])[Number(key.slice(2))]; return p ? p.title : ''; }
    if (key === 'prodotti') return (n.products || []).map((p) => p.title).join('\n');
    if (key === 'tutto') {
      return [
        `OGGETTO: ${n.subject || ''}`,
        `ANTEPRIMA: ${n.preview || ''}`,
        '',
        n.title || '',
        '',
        n.body || '',
        '',
        `PULSANTE: ${n.cta || ''} → ${siteUrl(n)}`,
        '',
        'PRODOTTI:',
        ...(n.products || []).map((p) => `- ${p.title} · ${p.price_text}${p.compare_at_text ? ` (invece di ${p.compare_at_text})` : ''} · ${p.url}`),
        '',
        n.send_suggestion ? `INVIO CONSIGLIATO: ${n.send_suggestion}` : '',
      ].join('\n').trim();
    }
    return n[key] || '';
  }

  // Il dominio vero del negozio è quello dei link dei prodotti dati da Shopify
  function siteUrl(n) {
    try { const u = (n.products || []).find((p) => p.url); if (u) return new URL(u.url).origin; } catch (_) { /* ignore */ }
    return n.shop_url || '';
  }

  const THEMES = { nuovi_arrivi: 'Nuovi arrivi', piu_venduti: 'I più venduti', saldi: 'Saldi', ricerca: 'Selezione' };

  function field(label, key, big) {
    const v = current[key];
    if (!v) return '';
    return `<div class="nl-field"><div class="nl-lab"><span>${label}</span><button class="mini-btn" data-copy="${key}">Copia</button></div>
      <div class="nl-val${big ? ' big' : ''}">${esc(v)}</div></div>`;
  }

  function render() {
    const n = current;
    const when = new Date(n.created_at).toLocaleString('it-IT', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    const prods = (n.products || []).map((p, i) => `<div class="nl-prod">
        ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : '<div class="nl-noimg"></div>'}
        <div class="nl-pinfo"><div class="item-title">${esc(p.title)}</div>
          <div class="muted">${esc(p.price_text)}${p.compare_at_text ? ` <s>${esc(p.compare_at_text)}</s> −${p.discount_pct}%` : ''}</div>
          <div class="nl-pbtns"><button class="mini-btn" data-copy="p:${i}">Copia nome</button><a class="mini-btn" href="${esc(p.url)}" target="_blank" rel="noopener">Apri</a></div></div>
      </div>`).join('');
    document.getElementById('nl-body').innerHTML = `
      <div class="sheet-head"><div><h1 id="nl-h">NEWSLETTER PRONTA</h1>
        <div class="muted">${esc(THEMES[n.theme] || 'Newsletter')} · preparata il ${esc(when)} · non ancora inviata</div></div>
        <button class="icon-btn" data-nl-close aria-label="Chiudi">✕</button></div>
      <ol class="nl-steps">
        <li>Apri Shopify Email: <b>Crea campagna</b> e scegli un modello.</li>
        <li>Copia oggetto, anteprima, titolo, testo e pulsante qui sotto.</li>
        <li>Nella sezione <b>Prodotti</b> del modello aggiungi i prodotti elencati: foto, prezzo e link li mette Shopify.</li>
        <li>${n.send_suggestion ? `Programma l'invio: consigliato <b>${esc(n.send_suggestion)}</b>.` : 'Programma l\'invio dal pulsante Programma.'}</li>
      </ol>
      <div class="nl-top-btns">
        <a class="mini-btn primary" href="${esc(n.shopify_email_url)}" target="_blank" rel="noopener">Apri Shopify Email</a>
        <button class="mini-btn" data-copy="tutto">Copia tutto</button>
      </div>
      ${field('Oggetto', 'subject')}
      ${field('Testo di anteprima', 'preview')}
      ${field('Titolo', 'title', true)}
      ${field('Testo', 'body')}
      ${field('Pulsante', 'cta')}
      <div class="nl-lab" style="margin-top:6px"><span>Prodotti (${(n.products || []).length})</span>${(n.products || []).length ? '<button class="mini-btn" data-copy="prodotti">Copia nomi</button>' : ''}</div>
      <div class="nl-prods">${prods || '<div class="off">Nessun prodotto</div>'}</div>
      <button class="big-btn" data-nl-close style="margin-top:8px">Chiudi</button>`;
  }

  async function open(id) {
    const o = el();
    try {
      const n = await deps.req(`/newsletter${id ? `?id=${encodeURIComponent(id)}` : ''}`);
      if (n.none) { deps.toast('Non c\'è ancora nessuna newsletter: chiedi «prepara la newsletter dei nuovi arrivi»', 5000); return; }
      current = n;
      render();
      o.classList.remove('hidden');
      o.querySelector('.sheet').scrollTop = 0;
    } catch (e) { deps.toast(`Non riesco ad aprire la newsletter: ${e.message}`); }
  }
  function close() { el().classList.add('hidden'); }

  window.CiccioNewsletter = { init: (d) => { deps = d; }, open, close };
})();
