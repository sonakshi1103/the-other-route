/* =========================================================
   The Other Route — game logic
   1. Setup and saved state (localStorage)
   2. Screen navigation + progress HUD
   3. Screen renderers (one per screen)
   4. Game actions (walking, choices, maze, endings)
   5. Forms and validation
   6. Input: clicks and keyboard
   7. Start: load story.json
   ========================================================= */
'use strict';

/* ---------- 1. Setup and saved state ---------- */

const RUN_KEY = 'otherRoute.run';      // the current playthrough
const FOUND_KEY = 'otherRoute.found';  // endings found (kept across playthroughs)

const WALK = { start: 250, min: 120, max: 860, step: 30, envelope: 545, reach: 40 };

// Screens that count as "in the middle of a story" (saved + resumable)
const PLAY_SCREENS = ['platform', 'choice', 'train', 'envelope', 'maze', 'shop'];
const SCREEN_LABELS = {
  platform: 'Subway platform', choice: 'The choice', train: 'Train ride',
  envelope: 'The envelope', maze: 'The maze', shop: 'Ice cream shop'
};

// Progress line stops for each route, and which stop each screen sits on
const ROUTES = {
  train:    { color: 'var(--red)',    stops: ['Platform', 'Choice', 'Ride', 'Shop', 'End'] },
  envelope: { color: 'var(--purple)', stops: ['Platform', 'Choice', 'Letter', 'Maze', 'End'] }
};
const STEP = { platform: 0, choice: 1, train: 2, envelope: 2, shop: 3, maze: 3, ending: 4 };

const MOUTHS = { happy: 'M-7 218 q7 6 14 0', neutral: 'M-7 220 h14', upset: 'M-7 223 q7 -6 14 0' };

// localStorage can throw (private mode, storage full), so every access is guarded
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ } },
  remove(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }
};

function newRun(name = '') {
  return {
    name, screen: null, route: null,
    node: 'start', mood: 0, companion: false, reaction: null,
    walkX: WALK.start, envelopeFound: false,
    maze: null, flavor: null, recap: [], ending: null
  };
}

let story = null;                                   // filled from story.json
let run = Object.assign(newRun(), store.get(RUN_KEY, {}));
let found = store.get(FOUND_KEY, []);
let current = 'home';

const saveRun = () => store.set(RUN_KEY, run);
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const announce = (msg) => { const s = $('#sr-status'); s.textContent = ''; setTimeout(() => { s.textContent = msg; }, 30); };
const fill = (text) => text.replace('{name}', run.name).replace('{flavor}', (run.flavor || 'ice cream').toLowerCase());

/* ---------- 2. Navigation + HUD ---------- */

function show(id) {
  if (!document.getElementById(id)) id = 'home';
  current = id;

  $$('.screen').forEach(s => s.classList.toggle('active', s.id === id));

  if (PLAY_SCREENS.includes(id) || id === 'ending') { run.screen = id; saveRun(); }
  if (renderers[id]) renderers[id]();
  renderHud(id);

  // Move focus to the new screen's main text so keyboard and screen-reader users follow along
  const focusTarget = $(`#${id} [data-focus]`);
  if (focusTarget) focusTarget.focus({ preventScroll: true });

  // Only the menu pages get a URL hash (mid-story screens need saved state to make sense)
  const hash = ['about', 'endings'].includes(id) ? '#' + id : ' ';
  try { history.replaceState(null, '', hash === ' ' ? location.pathname : hash); } catch (e) { /* file:// */ }
}

function renderHud(id) {
  const hud = $(`#${id} .hud`);
  if (!hud) return;
  const route = ROUTES[run.route || 'train'];
  const now = STEP[id] ?? 0;
  const parts = route.stops.map((name, i) => {
    const cls = i < now ? 'done' : i === now ? 'now' : '';
    const seg = i ? `<div class="seg${i <= now ? ' done' : ''}"></div>` : '';
    return `${seg}<div class="stop ${cls}"><div class="pin"></div><span>${name}</span></div>`;
  });
  hud.style.setProperty('--c', route.color);
  hud.innerHTML = `<div class="progress" role="img" aria-label="Progress: ${route.stops[now]}, stop ${now + 1} of ${route.stops.length}">${parts.join('')}</div>
    <button class="iconbtn" data-action="pause" aria-label="Pause menu">❚❚</button>`;
}

/* ---------- 3. Screen renderers ---------- */

const renderers = {
  home() {
    const btn = $('#continue-btn');
    const canResume = PLAY_SCREENS.includes(run.screen) && run.name;
    btn.hidden = !canResume;
    if (canResume) btn.firstChild.textContent = `Continue · ${SCREEN_LABELS[run.screen]} `;
    $('#endings-link').textContent = `Endings (${found.length}/${story ? story.endingOrder.length : 4})`;
  },

  name() {
    const input = $('#player-name');
    input.value = run.name || '';
    setFieldError(input, $('#name-error'), '');
  },

  platform() {
    $('#walker').setAttribute('transform', `translate(${run.walkX} 0)`);
    const btn = $('#pickup-btn');
    delete btn.dataset.announced;
    $('#platform-text').textContent = run.envelopeFound
      ? 'The red envelope is right by the pillar. A train is pulling into the station.'
      : 'You arrive at the subway station, trying to figure out which train to take to a famous ice cream shop across the city. As you look around the platform, something red catches your eye near one of the pillars.';
    if (run.envelopeFound) btn.dataset.announced = '1';
    updateEnvelopeHint(false);
  },

  choice() {
    $('#choice-text').textContent =
      `The train doors slide open. You look down at the red envelope: your name, ${run.name}, is written on the front, even though you don't know anyone in this city.`;
  },

  train() {
    const node = story.dialogue[run.node];
    const line = $('#train-line');
    const box = $('#train-choices');
    box.innerHTML = '';

    if (run.reaction) {
      // Show the stranger's reaction to the second choice, then one Continue button
      line.textContent = run.reaction.text;
      box.append(makeChoice(1, 'Continue →', 'train-continue', true));
    } else {
      line.textContent = node.line;
      node.choices.forEach((c, i) => box.append(makeChoice(i + 1, c.text, 'say', i === 0, i)));
    }
    line.parentElement.classList.remove('pop'); void line.offsetWidth; line.parentElement.classList.add('pop');
    $('#stranger-mouth').setAttribute('d', run.mood > 0 ? MOUTHS.happy : run.mood < 0 ? MOUTHS.upset : MOUTHS.neutral);
    announce('The stranger says: ' + line.textContent);
  },

  envelope() {
    $$('.player-name').forEach(el => { el.textContent = run.name; });
  },

  maze() {
    if (!run.maze) resetMaze();
    drawMaze();
  },

  shop() {
    $('#shop-text').textContent = run.companion
      ? 'You made it, and your new friend holds the door open. Which flavor are you getting?'
      : 'You finally made it to the ice cream shop! Which flavor are you getting?';
    const form = $('#flavor-form');
    $$('input[name="flavor"]', form).forEach(r => { r.checked = r.value === run.flavor; });
    $('#flavor-error').textContent = '';
    updateOrderLabel();
  },

  ending() {
    const id = run.ending;
    const e = story.endings[id];
    if (!e) return show('home');
    const total = story.endingOrder.length;
    $('#ending').dataset.ending = id;
    $$('#ending [data-scene]').forEach(g => { g.style.display = g.dataset.scene === e.scene ? '' : 'none'; });
    $('#ending-eyebrow').textContent = `Ending ${story.endingOrder.indexOf(id) + 1} of ${total}`;
    $('#ending-title').textContent = e.title;
    $('#ending-text').textContent = fill(e.text);
    const recap = $('#ending-recap');
    recap.innerHTML = '';
    run.recap.forEach(item => { const li = document.createElement('li'); li.textContent = item; recap.append(li); });
    const left = total - found.length;
    $('#ending-count').textContent = left === 0
      ? `You've found all ${total} endings. Nicely done.`
      : `You've found ${found.length} of ${total} endings. There ${left === 1 ? 'is 1 other way' : `are ${left} other ways`} this day could have gone.`;
  },

  endings() {
    const total = story.endingOrder.length;
    $('#found-count').textContent = found.length;

    // Light up the parts of the route map the player has reached
    $$('#route-map .seg[data-ends]').forEach(p => {
      p.classList.toggle('on', p.dataset.ends.split(' ').some(id => found.includes(id)));
    });
    $$('#route-map [data-end]').forEach(el => {
      const id = el.dataset.end, on = found.includes(id);
      el.classList.toggle('on', on);
      if (el.tagName === 'text') el.textContent = on ? story.endings[id].title : 'Locked';
    });
    $('#route-map').setAttribute('aria-label', `Map of story routes: ${found.length} of ${total} endings found`);

    const list = $('#endlist');
    list.innerHTML = '';
    story.endingOrder.forEach(id => {
      const e = story.endings[id], on = found.includes(id);
      const li = document.createElement('li');
      li.className = on ? '' : 'locked';
      li.innerHTML = '<b></b><span></span>';
      li.querySelector('b').textContent = on ? e.title : 'Locked';
      li.querySelector('span').textContent = on ? fill(e.text).split('.')[0] + '.' : 'Hint: ' + e.hint;
      list.append(li);
    });

    const canResume = PLAY_SCREENS.includes(run.screen) && run.name;
    $('#resume-card').hidden = !canResume;
    if (canResume) {
      $('#resume-label').textContent = `In progress: ${SCREEN_LABELS[run.screen]}`;
      $('#resume-name').textContent = `Playing as ${run.name}`;
    }
    resetConfirm();
  }
};

function makeChoice(num, text, action, primary, index) {
  const b = document.createElement('button');
  b.className = 'choice' + (primary ? ' primary' : '');
  b.dataset.action = action;
  if (index !== undefined) b.dataset.index = index;
  const k = document.createElement('kbd');
  k.textContent = num;
  b.append(k, document.createTextNode(text));
  return b;
}

/* ---------- 4. Game actions ---------- */

// Platform walk
function walk(dir) {
  run.walkX = Math.min(WALK.max, Math.max(WALK.min, run.walkX + dir * WALK.step));
  $('#walker').setAttribute('transform', `translate(${run.walkX} 0)`);
  updateEnvelopeHint(true);
  saveRun();
}

function updateEnvelopeHint(fromWalking) {
  const near = Math.abs(run.walkX - WALK.envelope) <= WALK.reach;
  const btn = $('#pickup-btn');
  if (near && !run.envelopeFound) run.envelopeFound = true;
  btn.hidden = !run.envelopeFound;
  if (near && fromWalking && btn.hidden === false && !btn.dataset.announced) {
    btn.dataset.announced = '1';
    $('#platform-text').textContent = 'There it is: a sealed red envelope, lying by the pillar. A train is pulling into the station.';
    announce('You found the envelope. Press 1 or the Pick up button.');
  }
}

// The big choice
function choose(route) {
  run.route = route;
  run.recap = [route === 'train' ? 'Boarded the train' : 'Opened the envelope'];
  run.node = 'start'; run.mood = 0; run.companion = false; run.reaction = null;
  run.maze = null; run.flavor = null; run.ending = null;
  show(route === 'train' ? 'train' : 'envelope');
}

// Train dialogue
function say(index) {
  const c = story.dialogue[run.node].choices[index];
  if (!c) return;
  run.mood += c.mood || 0;
  if (c.recap) run.recap.push(c.recap);
  if (c.companion) run.companion = true;
  if (c.reaction) {
    run.reaction = { text: c.reaction, next: c.next || null, ending: c.ending || null };
    saveRun();
    renderers.train();
    $('#train-who').focus({ preventScroll: true });
  } else {
    goNext(c.next, c.ending);
  }
}

function goNext(next, ending) {
  run.reaction = null;
  if (ending) return finishStory(ending);
  if (next === 'shop') return show('shop');
  run.node = next;
  saveRun();
  renderers.train();
  $('#train-who').focus({ preventScroll: true });
}

// Maze
let mazeGrid = [];   // array of strings from story.json

function findCell(ch) {
  for (let r = 0; r < mazeGrid.length; r++) {
    const c = mazeGrid[r].indexOf(ch);
    if (c !== -1) return { r, c };
  }
  return { r: 1, c: 1 };
}

function resetMaze() {
  const s = findCell('S');
  run.maze = { r: s.r, c: s.c, moves: 0 };
  saveRun();
}

function buildMaze() {
  const board = $('#maze-board');
  board.style.gridTemplateColumns = `repeat(${mazeGrid[0].length}, 1fr)`;
  board.innerHTML = '';
  mazeGrid.forEach((row, r) => [...row].forEach((ch, c) => {
    const cell = document.createElement('div');
    cell.className = 'cell' + (ch === '#' ? ' wall' : ch === 'E' ? ' exit' : '');
    cell.dataset.pos = `${r}-${c}`;
    board.append(cell);
  }));
}

function drawMaze() {
  $$('#maze-board .player').forEach(el => el.classList.remove('player'));
  const { r, c, moves } = run.maze;
  $(`#maze-board [data-pos="${r}-${c}"]`).classList.add('player');
  $('#maze-moves').textContent = moves;
}

let mazeDone = false;
function moveMaze(dr, dc) {
  if (mazeDone || !run.maze) return;
  const r = run.maze.r + dr, c = run.maze.c + dc;
  const ch = (mazeGrid[r] || '')[c];
  const msg = $('#maze-msg');

  if (ch === undefined || ch === '#') {
    msg.textContent = "That's a wall.";
    const board = $('#maze-board');
    board.classList.remove('bump'); void board.offsetWidth; board.classList.add('bump');
    return;
  }
  msg.textContent = '';
  run.maze.r = r; run.maze.c = c; run.maze.moves++;
  drawMaze();
  saveRun();

  if (ch === 'E') {
    mazeDone = true;
    run.recap.push(`Solved the maze in ${run.maze.moves} moves`);
    announce('You reached the door.');
    setTimeout(() => { mazeDone = false; finishStory('secretGarden'); }, 450);
  }
}

// Endings
function finishStory(endingId) {
  run.ending = endingId;
  if (!found.includes(endingId)) { found.push(endingId); store.set(FOUND_KEY, found); }
  saveRun();
  show('ending');
}

function replayFromChoice() {
  const name = run.name;
  run = newRun(name);
  run.walkX = WALK.envelope; run.envelopeFound = true;
  show('choice');
}

function restartStory() {
  run = newRun(run.name);
  saveRun();
  show('platform');
}

// Two-step reset so progress isn't wiped by one stray click
let resetArmed = false;
function resetConfirm() { resetArmed = false; const b = $('#reset-btn'); b.textContent = 'Reset all progress'; b.classList.remove('confirm'); }
function resetAll() {
  const b = $('#reset-btn');
  if (!resetArmed) {
    resetArmed = true;
    b.textContent = 'Click again to erase all endings and your save';
    b.classList.add('confirm');
    return;
  }
  found = []; run = newRun();
  store.remove(FOUND_KEY); store.remove(RUN_KEY);
  announce('All progress has been reset.');
  renderers.endings();
}

/* ---------- 5. Forms and validation ---------- */

const NAME_PATTERN = /^[A-Za-zÀ-ÖØ-öø-ÿ' -]+$/;

function validateName(raw) {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) return { error: 'Please enter your name.' };
  if (name.length > 20) return { error: `That's ${name.length} characters. Please keep it to 20 or fewer.` };
  if (!NAME_PATTERN.test(name)) return { error: 'Use letters, spaces, hyphens or apostrophes only.' };
  if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(name)) return { error: 'Your name needs at least one letter.' };
  return { name };
}

function setFieldError(input, errorEl, message) {
  errorEl.textContent = message;
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

$('#name-form').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('#player-name');
  const result = validateName(input.value);
  if (result.error) {
    setFieldError(input, $('#name-error'), result.error);
    input.focus();
    return;
  }
  run = newRun(result.name);
  saveRun();
  show('platform');
});

// Clear the error as soon as the input becomes valid
$('#player-name').addEventListener('input', e => {
  if (e.target.getAttribute('aria-invalid') && !validateName(e.target.value).error) {
    setFieldError(e.target, $('#name-error'), '');
  }
});

function updateOrderLabel() {
  const checked = $('#flavor-form input[name="flavor"]:checked');
  $('#order-btn').firstChild.textContent = checked ? `Order ${checked.value} ` : 'Order ';
}

$('#flavor-form').addEventListener('change', () => { $('#flavor-error').textContent = ''; updateOrderLabel(); });

$('#flavor-form').addEventListener('submit', e => {
  e.preventDefault();
  const checked = $('#flavor-form input[name="flavor"]:checked');
  if (!checked) {
    $('#flavor-error').textContent = 'Pick a flavor first. The line is getting impatient!';
    $('#flavor-form input[name="flavor"]').focus();
    return;
  }
  run.flavor = checked.value;
  run.recap.push(`Ordered ${checked.value}`);
  finishStory(run.companion ? 'newFriend' : 'sweetArrival');
});

/* ---------- 6. Input: clicks and keyboard ---------- */

const pauseDialog = $('#pause');

const actions = {
  continue: () => show(run.screen),
  pause: () => pauseDialog.showModal(),
  resume: () => pauseDialog.close(),
  restart: () => { pauseDialog.close(); restartStory(); },
  quit: () => { pauseDialog.close(); show('home'); },
  'walk-left': () => walk(-1),
  'walk-right': () => walk(1),
  pickup: () => show('choice'),
  board: () => choose('train'),
  open: () => choose('envelope'),
  say: (el) => say(+el.dataset.index),
  'train-continue': () => goNext(run.reaction.next, run.reaction.ending),
  'start-maze': () => { resetMaze(); show('maze'); },
  move: (el) => moveMaze(+el.dataset.dr, +el.dataset.dc),
  'maze-restart': () => { resetMaze(); drawMaze(); $('#maze-msg').textContent = ''; },
  replay: replayFromChoice,
  'reset-all': resetAll
};

document.addEventListener('click', e => {
  const go = e.target.closest('[data-go]');
  if (go) { show(go.dataset.go); return; }
  const act = e.target.closest('[data-action]');
  if (act && actions[act.dataset.action]) actions[act.dataset.action](act);
});

const ARROWS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

document.addEventListener('keydown', e => {
  if (pauseDialog.open) return;                    // the dialog handles its own keys (Esc closes it)
  if (e.target.matches('input[type="text"]')) return;

  // preventDefault stops this same Escape press from instantly closing the dialog it opens
  if (e.key === 'Escape' && PLAY_SCREENS.includes(current)) { e.preventDefault(); pauseDialog.showModal(); return; }

  if (current === 'platform' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    walk(e.key === 'ArrowLeft' ? -1 : 1);
    return;
  }
  if (current === 'maze' && ARROWS[e.key]) {
    e.preventDefault();
    moveMaze(...ARROWS[e.key]);
    return;
  }
  if (/^[1-3]$/.test(e.key) && !e.repeat) {
    const visible = $$(`#${current} .choices .choice`).filter(b => !b.hidden && b.offsetParent !== null);
    const btn = visible[+e.key - 1];
    if (btn) btn.click();
  }
});

/* ---------- 7. Start: load story.json ---------- */

fetch('story.json')
  .then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
  .then(data => {
    story = data;
    mazeGrid = story.maze;
    buildMaze();
    // Drop saved endings that no longer exist in the story file
    found = found.filter(id => story.endings[id]);
    const start = location.hash.slice(1);
    show(['about', 'endings'].includes(start) ? start : 'home');
  })
  .catch(err => {
    console.error('Could not load story.json:', err);
    show('home');
    $('#load-error').hidden = false;
    $('#start-btn').disabled = true;
    $('#continue-btn').hidden = true;
    $('#endings-link').disabled = true;
  });
