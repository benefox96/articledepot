'use strict';

const CATEGORY_LABELS = {
  option: 'Option potential',
  inspiration: 'Food for thought',
  pass: 'Pass',
};
const CATEGORY_HINTS = {
  option: 'Worth exploring further as a potential option',
  inspiration: 'Interesting material for a screenwriter',
  pass: 'Not pursuing',
};

const state = {
  articles: [],
  category: 'option',
  person: '',
  search: '',
  groupBy: 'person',
};

const els = {
  tabs: document.getElementById('category-tabs'),
  person: document.getElementById('person-filter'),
  search: document.getElementById('search'),
  groupBy: document.getElementById('group-by'),
  status: document.getElementById('status'),
  results: document.getElementById('results'),
  keyDialog: document.getElementById('key-dialog'),
  keyForm: document.getElementById('key-form'),
  keyInput: document.getElementById('key-input'),
  cardTemplate: document.getElementById('card-template'),
};

// ---- Persistence of per-viewer preferences ---------------------------------

function readPref(key) {
  try { return localStorage.getItem(`articledepot.${key}`); } catch { return null; }
}
function writePref(key, value) {
  try { localStorage.setItem(`articledepot.${key}`, value); } catch { /* ignore */ }
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
  els.status.textContent = 'Loading…';
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

// ---- Rendering --------------------------------------------------------------

function people() {
  const names = new Map();
  for (const a of state.articles) {
    const key = a.flaggedBy.toLowerCase();
    if (!names.has(key)) names.set(key, a.flaggedBy);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

function matchesFilters(article, { ignoreCategory = false } = {}) {
  if (!ignoreCategory && article.category !== state.category) return false;
  if (state.person && article.flaggedBy.toLowerCase() !== state.person.toLowerCase()) return false;
  if (state.search) {
    const haystack = [article.title, article.siteName, article.description, article.notes, article.url]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(state.search.toLowerCase())) return false;
  }
  return true;
}

function renderTabs() {
  els.tabs.replaceChildren();
  for (const [value, label] of Object.entries(CATEGORY_LABELS)) {
    const count = state.articles.filter(
      (a) => a.category === value && matchesFilters(a, { ignoreCategory: true })
    ).length;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tab tab-${value}`;
    button.title = CATEGORY_HINTS[value];
    button.setAttribute('aria-pressed', String(state.category === value));
    const name = document.createElement('span');
    name.textContent = label;
    const badge = document.createElement('span');
    badge.className = 'count';
    badge.textContent = count;
    button.append(name, badge);
    button.addEventListener('click', () => {
      state.category = value;
      writePref('category', value);
      render();
    });
    els.tabs.append(button);
  }
}

function renderPeopleFilter() {
  const current = state.person;
  els.person.replaceChildren(new Option('Everyone', ''));
  for (const name of people()) els.person.append(new Option(name, name));
  els.person.value = people().some((p) => p.toLowerCase() === current.toLowerCase()) ? current : '';
  state.person = els.person.value;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function buildCard(article, { showPerson }) {
  const node = els.cardTemplate.content.firstElementChild.cloneNode(true);
  node.classList.add(`card-${article.category}`);

  const title = node.querySelector('.card-title');
  title.href = article.url;
  title.textContent = article.title;

  const meta = [];
  meta.push(article.siteName || new URL(article.url).hostname.replace(/^www\./, ''));
  if (showPerson) meta.push(`flagged by ${article.flaggedBy}`);
  meta.push(formatDate(article.createdAt));
  node.querySelector('.card-meta').textContent = meta.join(' · ');

  const description = node.querySelector('.card-description');
  if (article.description) description.textContent = article.description;
  else description.remove();

  const notes = node.querySelector('textarea');
  notes.value = article.notes;
  notes.addEventListener('change', async () => {
    try {
      await updateArticle(article.id, { notes: notes.value });
      els.status.textContent = 'Note saved.';
    } catch (err) {
      els.status.textContent = `Couldn't save note: ${err.message}`;
    }
  });

  const select = node.querySelector('.card-category');
  for (const [value, label] of Object.entries(CATEGORY_LABELS)) {
    select.append(new Option(label, value));
  }
  select.value = article.category;
  select.addEventListener('change', async () => {
    try {
      await updateArticle(article.id, { category: select.value });
      els.status.textContent = `Moved “${article.title}” to ${CATEGORY_LABELS[select.value]}.`;
      render();
    } catch (err) {
      select.value = article.category;
      els.status.textContent = `Couldn't move article: ${err.message}`;
    }
  });

  node.querySelector('.card-delete').addEventListener('click', async () => {
    if (!confirm(`Remove “${article.title}” from Article Depot?`)) return;
    try {
      await deleteArticle(article.id);
      els.status.textContent = 'Article removed.';
      render();
    } catch (err) {
      els.status.textContent = `Couldn't remove article: ${err.message}`;
    }
  });

  return node;
}

function renderResults() {
  const visible = state.articles.filter((a) => matchesFilters(a));
  els.results.replaceChildren();

  if (!visible.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = state.articles.length
      ? `Nothing in ${CATEGORY_LABELS[state.category]} matches these filters.`
      : 'No articles yet. Flag one with the browser extension and it will show up here.';
    els.results.append(empty);
    return;
  }

  if (state.groupBy === 'none') {
    const list = document.createElement('div');
    list.className = 'cards';
    for (const a of visible) list.append(buildCard(a, { showPerson: true }));
    els.results.append(list);
    return;
  }

  const groups = new Map();
  for (const a of visible) {
    const key = a.flaggedBy.toLowerCase();
    if (!groups.has(key)) groups.set(key, { name: a.flaggedBy, articles: [] });
    groups.get(key).articles.push(a);
  }
  const sorted = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const group of sorted) {
    const section = document.createElement('section');
    section.className = 'group';
    const heading = document.createElement('h2');
    heading.textContent = group.name;
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = group.articles.length;
    heading.append(' ', count);
    const list = document.createElement('div');
    list.className = 'cards';
    for (const a of group.articles) list.append(buildCard(a, { showPerson: false }));
    section.append(heading, list);
    els.results.append(section);
  }
}

function render() {
  renderPeopleFilter();
  renderTabs();
  renderResults();
}

// ---- Wiring -----------------------------------------------------------------

state.category = CATEGORY_LABELS[readPref('category')] ? readPref('category') : 'option';
state.groupBy = readPref('groupBy') === 'none' ? 'none' : 'person';
state.person = readPref('person') || '';
els.groupBy.value = state.groupBy;

els.person.addEventListener('change', () => {
  state.person = els.person.value;
  writePref('person', state.person);
  render();
});
els.search.addEventListener('input', () => {
  state.search = els.search.value.trim();
  renderTabs();
  renderResults();
});
els.groupBy.addEventListener('change', () => {
  state.groupBy = els.groupBy.value;
  writePref('groupBy', state.groupBy);
  renderResults();
});

// Pick up articles flagged by teammates when coming back to the tab.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadArticles();
});

loadArticles();
