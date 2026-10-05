# Article Depot

A browser extension plus a small shared server for collecting articles the team finds online into one webpage.

When someone finds an article worth sharing, they click the **Article Depot** button in their browser and file it under one of three categories:

| Category | Meaning |
| --- | --- |
| **Option potential** | Worth exploring further as a possible option |
| **Food for thought** | Interesting material for a screenwriter, but not something to option |
| **Pass** | Not exploring further |

Each article is filed under the name of the person who flagged it. On the shared **Article Depot page**, the team can:

- switch between the three categories
- filter by person and search titles, sites and notes
- group articles by person, or list everything newest-first
- move an article to a different category, add notes, or remove it

```
 ┌─────────────────────┐      POST /api/articles      ┌──────────────────────┐
 │ Browser extension   │ ───────────────────────────▶ │ Article Depot server │
 │ (each team member)  │                              │  • stores articles   │
 └─────────────────────┘                              │  • serves the page   │
                                                      └──────────▲───────────┘
                                         the team opens the page │
                                                                 │
                                                       https://your-server/
```

## 1. Run the server

The server needs only [Node.js](https://nodejs.org) 18 or newer, with no other dependencies.

```bash
TEAM_KEY="pick-a-long-random-phrase" PORT=3000 npm start
```

Then open `http://localhost:3000` to see the Article Depot page.

| Setting | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `TEAM_KEY` | *(none)* | Shared password. Anyone using the extension or the page must enter it. **Set this for any server reachable outside your own computer.** |
| `DATA_FILE` | `data/articles.json` | Where articles are stored. Back this file up. |

For the whole team to use it, run the server somewhere everyone can reach, such as a small cloud VM, an internal server, or a platform like Render, Railway or Fly.io. Put it behind HTTPS (most hosting platforms do this for you) so the team key isn't sent in the clear. If the platform's disk isn't permanent, point `DATA_FILE` at a mounted volume so articles survive restarts.

## 2. Install the extension

The extension lives in the [`extension/`](extension) folder and works in Chrome, Edge, Brave and other Chromium browsers. It should also work in Firefox 115+.

**Chrome / Edge / Brave**

1. Go to `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose the `extension` folder.
4. Pin the Article Depot button to the toolbar.

**Firefox**: go to `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick `extension/manifest.json`. A temporary add-on is removed when Firefox restarts. To install it permanently, the extension has to be signed through [addons.mozilla.org](https://addons.mozilla.org/developers/) (an unlisted add-on is fine).

To roll it out to a larger team without Developer mode, publish it as an **unlisted** or **private** item on the Chrome Web Store, or push it with your company's browser management (Google Admin / Microsoft Intune).

### First-time setup

The first time you click the button, the extension asks for:

- **Your name**: articles are filed under this name, so use the same spelling on every computer.
- **Server address**: for example, `https://articles.yourcompany.com`.
- **Team key**: the `TEAM_KEY` set on the server.

Click **Test connection** to check everything is right.

## Using it

1. On an article, click the Article Depot button.
2. The title is filled in from the page. Edit it if you like.
3. Pick **Option potential**, **Food for thought** or **Pass**, optionally add a note, and click **Save**.

If you flag the same article again, your existing entry is updated rather than duplicated. If a colleague flags the same article, it appears under their name as well, so you can see when more than one person found it interesting.

## Privacy and permissions

The extension asks for only three permissions:

- `activeTab` and `scripting`: when you click the button, it reads the current page's title, description and site name. It reads nothing until you click, and nothing on other tabs.
- `storage`: keeps your name, server address and team key in your browser.

It sends data only to the server address you configure.

## Development

```bash
npm test         # API tests (Node's built-in test runner)
npm start        # run the server
```

```
extension/   Browser extension (Manifest V3): popup, settings page, icons
server/      Node server: JSON API + the shared Article Depot page (server/public)
test/        API tests
```

### API

All `/api` routes require an `X-Team-Key` header when `TEAM_KEY` is set.

| Method | Path | Body |
| --- | --- | --- |
| `GET` | `/api/articles` | |
| `POST` | `/api/articles` | `{ url, title?, description?, siteName?, flaggedBy, category, notes? }` |
| `PATCH` | `/api/articles/:id` | any of `{ category, notes, title }` |
| `DELETE` | `/api/articles/:id` | |

`category` is one of `option`, `inspiration` or `pass`.
