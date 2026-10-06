'use strict';

// Whose bookcase stands on each side. The To Discuss bookcase is always in the middle.
// Articles flagged by anyone else get a bookcase of their own after these three.
const LEFT_PERSON = 'Ben';
const RIGHT_PERSON = 'Stephanie';

const SHELVES = [
  { category: 'option', label: 'Option potential' },
  { category: 'inspiration', label: 'Food for thought' },
  { category: 'pass', label: 'Pass' },
];
const SHELF_LABELS = Object.fromEntries(SHELVES.map((s) => [s.category, s.label]));

// Leather-bound spine colors. Light ones get dark lettering.
const SPINES = [
  { color: '#6b1f24' }, { color: '#1f3a5f' }, { color: '#2f4f3a' }, { color: '#4a3b5c' },
  { color: '#1f5257' }, { color: '#8a3b1e' }, { color: '#2b2b33' }, { color: '#7d2f4a' },
  { color: '#5c6b3a' }, { color: '#3d2a1e' },
  { color: '#c49a45', light: true }, { color: '#cdb98f', light: true }, { color: '#9fb3a3', light: true },
];

const state = { articles: [], search: '', openId: null };

const els = {
  bookcases: document.getElementById('bookcases'),
  search: document.getElementById('search'),
  status: document.getElementById('status'),
  toast: document.getElementById('toast'),
  keyDialog: document.getElementById('key-dialog'),
  keyForm: document.getElementById('key-form'),
  keyInput: document.getElementById('key-input'),
  card: {
    dialog: document.getElementById('book-dialog'),
    close: document.getElementById('card-close'),
    kicker: document.getElementById('card-kicker'),
    title: document.getElementById('card-title'),
    site: document.getElementById('card-site'),
    description: document.getElementById('card-description'),
    link: document.getElementById('card-link'),
    category: document.getElementById('card-category'),
    discuss: document.getElementById('card-discuss'),
    notes: document.getElementById('card-notes'),
    notesSaved: document.getElementById('notes-saved'),
    remove: document.getElementById('card-remove'),
  },
};

// ---- Helpers ----------------------------------------------------------------

function readPref(key) {
  try { return localStorage.getItem(`articledepot.${key}`); } catch { return null; }
}
function writePref(key, value) {
  try { localStorage.setItem(`articledepot.${key}`, value); } catch { /* ignore */ }
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function samePerson(a, b) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function siteName(article) {
  if (article.siteName) return article.siteName;
  try { return new URL(article.url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

let toastTimer;
function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
}

// ---- API --------------------------------------------------------------------

function askForKey() {
  return new Promise((resolve) => {
    els.keyInput.value = '';
    els.keyForm.addEventListener('submit', () => {
      writePref('teamKey', els.keyInput.value.trim());
      resolve();
    }, { once: true });
    els.keyDialog.showModal();
  });
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const key = readPref('teamKey');
  if (key) headers['X-Team-Key'] = key;
  if (options.body) headers['Content-Type'] = 'application/json';

  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) {
    await askForKey();
    return api(path, options);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

async function loadArticles() {
  if (!state.articles.length) els.status.textContent = 'Opening the library…';
  try {
    const { articles } = await api('/api/articles');
    state.articles = articles;
    els.status.textContent = '';
    render();
  } catch (err) {
    els.status.textContent = `Couldn't load articles: ${err.message}`;
  }
}

async function updateArticle(id, changes) {
  const { article } = await api(`/api/articles/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  });
  const index = state.articles.findIndex((a) => a.id === id);
  if (index !== -1) state.articles[index] = article;
  return article;
}

async function deleteArticle(id) {
  await api(`/api/articles/${id}`, { method: 'DELETE' });
  state.articles = state.articles.filter((a) => a.id !== id);
}

// ---- Bookcases --------------------------------------------------------------

function bookcaseLayout() {
  const cases = [
    { key: 'left', name: LEFT_PERSON, articles: [] },
    { key: 'discuss', name: 'To Discuss', articles: [], showInitials: true },
    { key: 'right', name: RIGHT_PERSON, articles: [] },
  ];
  const others = new Map();

  for (const article of state.articles) {
    if (article.discuss) cases[1].articles.push(article);
    else if (samePerson(article.flaggedBy, LEFT_PERSON)) cases[0].articles.push(article);
    else if (samePerson(article.flaggedBy, RIGHT_PERSON)) cases[2].articles.push(article);
    else {
      const key = article.flaggedBy.trim().toLowerCase();
      if (!others.has(key)) others.set(key, { key: `other-${key}`, name: article.flaggedBy, articles: [] });
      others.get(key).articles.push(article);
    }
  }
  return [...cases, ...[...others.values()].sort((a, b) => a.name.localeCompare(b.name))];
}

function matchesSearch(article) {
  if (!state.search) return true;
  return [article.title, siteName(article), article.description, article.notes, article.flaggedBy]
    .join(' ')
    .toLowerCase()
    .includes(state.search.toLowerCase());
}

function buildBook(article, { showInitials }) {
  const h = hash(article.id);
  const spine = SPINES[h % SPINES.length];
  const book = document.createElement('button');
  book.type = 'button';
  book.className = 'book';
  if (spine.light) book.classList.add('light-spine');
  book.style.setProperty('--spine', spine.color);
  book.style.setProperty('--h', `${150 + ((h >>> 4) % 36)}px`);
  book.style.setProperty('--w', `${42 + ((h >>> 9) % 12)}px`);
  book.title = `${article.title} · ${siteName(article)}`;
  book.setAttribute('aria-label', `${article.title}, flagged by ${article.flaggedBy}`);

  const title = document.createElement('span');
  title.className = 'book-title';
  title.textContent = article.title;
  book.append(title);

  if (showInitials) {
    const initial = document.createElement('span');
    initial.className = 'book-initial';
    initial.textContent = article.flaggedBy.trim().charAt(0).toUpperCase();
    initial.setAttribute('aria-hidden', 'true');
    book.append(initial);
  }

  if (!matchesSearch(article)) book.classList.add('dim');
  else if (state.search) book.classList.add('highlight');

  book.addEventListener('click', () => openCard(article.id));
  return book;
}

function buildBookcase(bookcase) {
  const section = document.createElement('section');
  section.className = `bookcase bookcase-${bookcase.key}`;
  section.setAttribute('aria-label', `${bookcase.name} bookcase`);

  const crown = document.createElement('div');
  crown.className = 'crown';

  const band = document.createElement('div');
  band.className = 'header-band';
  const plate = document.createElement('div');
  plate.className = 'nameplate';
  const name = document.createElement('h2');
  name.textContent = bookcase.name;
  const count = document.createElement('p');
  const n = bookcase.articles.length;
  count.textContent = `${n} ${n === 1 ? 'article' : 'articles'}`;
  plate.append(name, count);
  band.append(plate);

  const cabinet = document.createElement('div');
  cabinet.className = 'cabinet';
  for (const shelf of SHELVES) {
    const articles = bookcase.articles.filter((a) => a.category === shelf.category);
    const shelfEl = document.createElement('section');
    shelfEl.className = 'shelf';
    shelfEl.setAttribute('aria-label', `${bookcase.name}: ${shelf.label}`);

    const books = document.createElement('div');
    books.className = 'books';
    if (articles.length) {
      for (const a of articles) books.append(buildBook(a, bookcase));
    } else {
      const empty = document.createElement('p');
      empty.className = 'shelf-empty';
      empty.textContent = 'Nothing here yet';
      books.append(empty);
    }

    const plank = document.createElement('div');
    plank.className = 'plank';
    const label = document.createElement('span');
    label.className = 'plank-label';
    label.textContent = shelf.label;
    const shelfCount = document.createElement('span');
    shelfCount.className = 'plank-count';
    shelfCount.textContent = articles.length;
    plank.append(label, shelfCount);

    shelfEl.append(books, plank);
    cabinet.append(shelfEl);
  }

  const base = document.createElement('div');
  base.className = 'base';

  section.append(crown, band, cabinet, base);
  return section;
}

function render() {
  // Keep each shelf's scroll position when re-rendering.
  const scrolls = [...els.bookcases.querySelectorAll('.books')].map((b) => b.scrollLeft);
  els.bookcases.replaceChildren(...bookcaseLayout().map(buildBookcase));
  els.bookcases.querySelectorAll('.books').forEach((b, i) => { b.scrollLeft = scrolls[i] || 0; });

  if (state.search) {
    const matches = state.articles.filter(matchesSearch).length;
    els.status.textContent = `${matches} ${matches === 1 ? 'article matches' : 'articles match'} “${state.search}”`;
  } else if (!els.status.textContent.startsWith("Couldn't")) {
    els.status.textContent = state.articles.length ? '' : 'The shelves are empty. Flag an article with the browser extension and it will appear here.';
  }

  if (state.openId) fillCard();
}

// ---- Article card -----------------------------------------------------------

function currentArticle() {
  return state.articles.find((a) => a.id === state.openId);
}

function fillCard() {
  const article = currentArticle();
  if (!article) {
    els.card.dialog.close();
    return;
  }
  const c = els.card;
  c.kicker.textContent = `Flagged by ${article.flaggedBy} · ${formatDate(article.createdAt)}`;
  c.title.textContent = article.title;
  c.site.textContent = siteName(article);
  c.description.textContent = article.description;
  c.description.hidden = !article.description;
  c.link.href = article.url;

  c.category.replaceChildren();
  for (const shelf of SHELVES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(article.category === shelf.category));
    button.textContent = shelf.label;
    button.addEventListener('click', () => changeArticle({ category: shelf.category },
      `Moved to ${shelf.label}`));
    c.category.append(button);
  }

  c.discuss.checked = article.discuss;
  if (document.activeElement !== c.notes) c.notes.value = article.notes;
}

function openCard(id) {
  state.openId = id;
  els.card.notesSaved.textContent = '';
  fillCard();
  els.card.dialog.showModal();
}

async function changeArticle(changes, message) {
  const article = currentArticle();
  if (!article) return;
  try {
    await updateArticle(article.id, changes);
    render();
    if (message) toast(message);
  } catch (err) {
    toast(`Couldn't save: ${err.message}`);
    fillCard();
  }
}

els.card.close.addEventListener('click', () => els.card.dialog.close());
els.card.dialog.addEventListener('click', (event) => {
  // Clicking the dimmed backdrop closes the card.
  if (event.target === els.card.dialog) els.card.dialog.close();
});
els.card.dialog.addEventListener('close', () => { state.openId = null; });

els.card.discuss.addEventListener('change', () => {
  const article = currentArticle();
  if (!article) return;
  const discuss = els.card.discuss.checked;
  changeArticle({ discuss }, discuss
    ? 'Moved to the To Discuss bookcase'
    : `Back on ${article.flaggedBy}’s bookcase`);
});

els.card.notes.addEventListener('change', async () => {
  const article = currentArticle();
  if (!article) return;
  try {
    await updateArticle(article.id, { notes: els.card.notes.value });
    els.card.notesSaved.textContent = 'Saved';
  } catch (err) {
    toast(`Couldn't save note: ${err.message}`);
  }
});

els.card.remove.addEventListener('click', async () => {
  const article = currentArticle();
  if (!article || !confirm(`Remove “${article.title}” from the library?`)) return;
  try {
    await deleteArticle(article.id);
    els.card.dialog.close();
    render();
    toast('Removed from the library');
  } catch (err) {
    toast(`Couldn't remove: ${err.message}`);
  }
});

// ---- Wiring -----------------------------------------------------------------

els.search.addEventListener('input', () => {
  state.search = els.search.value.trim();
  render();
});

// Pick up articles flagged by teammates when coming back to the tab.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadArticles();
});

loadArticles();
