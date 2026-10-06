'use strict';

const form = document.getElementById('flag-form');
const setup = document.getElementById('setup');
const titleInput = document.getElementById('title');
const urlText = document.getElementById('url');
const notesInput = document.getElementById('notes');
const saveButton = document.getElementById('save');
const message = document.getElementById('message');

let settings;
let page = { url: '', title: '', description: '', siteName: '' };

// Runs inside the article's tab to pick up the nicest title/description it offers.
function readPageMetadata() {
  const meta = (selector) => document.querySelector(selector)?.getAttribute('content')?.trim() || '';
  return {
    title: meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]') || document.title,
    description:
      meta('meta[property="og:description"]') ||
      meta('meta[name="description"]') ||
      meta('meta[name="twitter:description"]'),
    siteName: meta('meta[property="og:site_name"]'),
    canonical: document.querySelector('link[rel="canonical"]')?.href || '',
  };
}

async function loadPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  page.url = tab.url || '';
  page.title = tab.title || '';
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readPageMetadata,
    });
    page.title = result.title || page.title;
    page.description = result.description;
    page.siteName = result.siteName;
    // Prefer the canonical link (drops tracking parameters) when it's a real web URL.
    if (/^https?:\/\//.test(result.canonical)) page.url = result.canonical;
  } catch {
    // Some pages (browser settings, the web store, PDFs) can't be scripted. The tab's
    // own title and URL are good enough there.
  }
}

function showMessage(text, kind = '') {
  message.textContent = text;
  message.className = `message ${kind}`;
}

async function init() {
  settings = await getSettings();
  if (!settings.serverUrl || !settings.name) {
    setup.hidden = false;
    return;
  }

  form.hidden = false;
  document.getElementById('who-name').textContent = settings.name;
  await loadPage();
  titleInput.value = page.title;
  urlText.textContent = page.url;

  if (!/^https?:\/\//.test(page.url)) {
    showMessage('Only web pages (http/https) can be flagged.', 'error');
    saveButton.disabled = true;
  }
}

document.getElementById('open-settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

document.getElementById('view-depot').addEventListener('click', (event) => {
  event.preventDefault();
  chrome.tabs.create({ url: `${normalizeServerUrl(settings.serverUrl)}/` });
  window.close();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const category = form.elements.category.value;
  if (!category) {
    showMessage('Pick a category first.', 'error');
    return;
  }

  saveButton.disabled = true;
  showMessage('Saving…');
  try {
    const { created } = await apiRequest(settings, '/api/articles', {
      method: 'POST',
      body: JSON.stringify({
        url: page.url,
        title: titleInput.value,
        description: page.description,
        siteName: page.siteName,
        flaggedBy: settings.name,
        category,
        notes: notesInput.value,
        // Left out when unticked, so re-flagging doesn't take an article off the To Discuss bookcase.
        ...(document.getElementById('discuss').checked ? { discuss: true } : {}),
      }),
    });
    showMessage(created ? 'Saved to Article Depot.' : 'You already flagged this, so it was updated.', 'success');
    setTimeout(() => window.close(), 1200);
  } catch (err) {
    showMessage(err.message, 'error');
    saveButton.disabled = false;
  }
});

init();
