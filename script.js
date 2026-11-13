// Build subway-line progress HUDs
  document.querySelectorAll('.hud').forEach(h => {
    const stops = h.dataset.hud.split(','), now = +h.dataset.now;
    let html = '<div class="progress" aria-label="Progress: ' + stops[now] + '">';
    stops.forEach((s, i) => {
      if (i) html += '<div class="seg' + (i <= now ? ' done' : '') + '"></div>';
      html += '<div class="stop' + (i < now ? ' done' : i === now ? ' now' : '') + '"><div class="pin"></div><span>' + s + '</span></div>';
    });
    html += '</div><button class="iconbtn" aria-label="Pause menu" data-go="home">❚❚</button>';
    h.innerHTML = html;
  });

  const screens = [...document.querySelectorAll('.screen')];
  const tabs = document.getElementById('tabs'), note = document.getElementById('note');
  screens.forEach(s => {
    const b = document.createElement('button');
    b.textContent = s.dataset.label; b.dataset.go = s.id;
    tabs.appendChild(b);
  });
  function show(id){
    screens.forEach(s => s.classList.toggle('active', s.id === id));
    tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-current', b.dataset.go === id));
    const s = document.getElementById(id); note.innerHTML = s.dataset.note;
    try { history.replaceState(null, '', '#' + id); } catch (e) {}
  }
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-go]'); if (t) show(t.dataset.go);
    const f = e.target.closest('.flavor');
    if (f) { f.parentElement.querySelectorAll('.flavor').forEach(x => { x.classList.toggle('sel', x === f); x.setAttribute('aria-checked', x === f); });
      const btn = f.closest('.panel').querySelector('.choice.primary'); btn.textContent = 'Order ' + f.textContent.trim() + ' →'; }
  });
  document.addEventListener('keydown', e => {
    const cur = screens.find(s => s.classList.contains('active'));
    if (e.key === 'ArrowRight' && cur.id === 'platform') show('choice');
    if (e.key === 'ArrowLeft' && cur.id === 'platform') e.preventDefault();
    if (/^[1-3]$/.test(e.key)) { const c = cur.querySelectorAll('.choices .choice')[+e.key - 1]; if (c) c.click(); }
  });
  document.getElementById('annoToggle').addEventListener('change', e => document.body.classList.toggle('hide-anno', !e.target.checked));
  show((location.hash || '#home').slice(1) in Object.fromEntries(screens.map(s => [s.id, 1])) ? location.hash.slice(1) || 'home' : 'home');
