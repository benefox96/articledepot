'use strict';

// Settings shared by the popup and options page, stored with chrome.storage.sync
// so they follow the person across their signed-in browsers.
const DEFAULT_SETTINGS = { serverUrl: '', teamKey: '', name: '' };

function getSettings() {
  return chrome.storage.sync.get(DEFAULT_SETTINGS);
}

function saveSettings(settings) {
  return chrome.storage.sync.set(settings);
}

function normalizeServerUrl(url) {
  return url.trim().replace(/\/+$/, '');
}

async function apiRequest(settings, path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (settings.teamKey) headers['X-Team-Key'] = settings.teamKey;
  if (options.body) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`${normalizeServerUrl(settings.serverUrl)}${path}`, { ...options, headers });
  } catch {
    throw new Error("Couldn't reach the Article Depot server. Check the server address in settings.");
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('The team key is missing or incorrect. Check settings.');
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}
