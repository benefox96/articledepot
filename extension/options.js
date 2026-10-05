'use strict';

const form = document.getElementById('options-form');
const nameInput = document.getElementById('name');
const serverInput = document.getElementById('server-url');
const keyInput = document.getElementById('team-key');
const message = document.getElementById('message');

function showMessage(text, kind = '') {
  message.textContent = text;
  message.className = `message ${kind}`;
}

function currentValues() {
  return {
    name: nameInput.value.trim(),
    serverUrl: normalizeServerUrl(serverInput.value),
    teamKey: keyInput.value.trim(),
  };
}

async function testConnection() {
  const values = currentValues();
  if (!values.serverUrl) {
    showMessage('Enter the server address first.', 'error');
    return false;
  }
  showMessage('Checking…');
  try {
    await apiRequest(values, '/api/config');
    showMessage('Connected to Article Depot.', 'success');
    return true;
  } catch (err) {
    showMessage(err.message, 'error');
    return false;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await saveSettings(currentValues());
  showMessage('Settings saved.', 'success');
  testConnection().then((ok) => {
    if (ok) showMessage('Settings saved and connected. You can start flagging articles.', 'success');
  });
});

document.getElementById('test').addEventListener('click', testConnection);

getSettings().then((settings) => {
  nameInput.value = settings.name;
  serverInput.value = settings.serverUrl;
  keyInput.value = settings.teamKey;
});
