# Article Depot

A browser extension plus a small shared web app for collecting articles the team finds online into one webpage.

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
 ┌─────────────────────┐      POST /api/articles      ┌──────────────────────────────┐
 │ Browser extension   │ ───────────────────────────▶ │ Cloudflare (free plan)       │
 │ (each team member)  │                              │  • Worker: the API           │
 └─────────────────────┘                              │  • D1 database: the articles │
                                                      │  • serves the shared page    │
                                                      └──────────────▲───────────────┘
                                             the team opens the page │
                                                  https://articledepot.<you>.workers.dev
```

## 1. Put it online with Cloudflare (free)

Article Depot runs on Cloudflare's free plan. Cloudflare runs the code (a "Worker"), stores the articles in its database (D1), and serves the shared page over HTTPS. No credit card is needed, and a team's usage is far below the free limits.

You only do this once. It takes about 10 minutes and happens entirely in the browser. Cloudflare's dashboard changes from time to time, so button names may differ slightly from these steps.

1. **Make sure this code is on the `main` branch** of the GitHub repository. Cloudflare publishes whatever is on `main`.
2. **Create a free Cloudflare account** at [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) and verify your email.
3. In the dashboard, go to **Workers & Pages** → **Create** → **Import a repository** (sometimes shown as *Connect to Git*).
4. **Connect GitHub** when asked, and give Cloudflare access to the `articledepot` repository. Then select it.
5. On the setup screen:
   - **Project name:** `articledepot`. It must match exactly, because the code expects that name.
   - **Build command:** leave empty.
   - **Deploy command:** `npx wrangler deploy` (usually filled in already).

   Click **Create and deploy** (or **Deploy**). The first deploy also creates the database automatically. Wait for it to finish, which takes a minute or two.
6. **Set the team key.** Open the new `articledepot` Worker → **Settings** → **Variables and Secrets** → **Add**:
   - **Type:** Secret
   - **Variable name:** `TEAM_KEY`
   - **Value:** a long password nobody would guess, e.g. four or five random words.

   Save and deploy. Until the key is set, Article Depot refuses all requests, so it's never accidentally open to the public.
7. **Find your address.** The Worker's overview page shows a link like `https://articledepot.your-name.workers.dev`. If Cloudflare asks you to choose a *workers.dev subdomain* first, pick something like your company name. Open the link: it should ask for the team key and then show an empty Article Depot page.

That's it. Send the team the address and the team key, sending the key privately, along with the extension steps below.

**Updates:** whenever new code lands on `main`, Cloudflare redeploys automatically. The articles are kept.

**Your own web address (optional):** an address like `articles.yourcompany.com` needs your domain's DNS to be managed by Cloudflare (Worker → **Settings** → **Domains & Routes**). If your domain is managed by Wix or another provider, moving it is more involved, and the `workers.dev` address works just as well.

**Backups:** Cloudflare's database keeps its own restore points for recent days ("Time Travel"). To keep your own copy, run this from any computer's terminal:

```bash
curl -H "X-Team-Key: YOUR_TEAM_KEY" https://articledepot.YOUR-NAME.workers.dev/api/articles > articledepot-backup.json
```

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
- **Server address**: the Cloudflare address from step 7, e.g. `https://articledepot.your-name.workers.dev`.
- **Team key**: the `TEAM_KEY` from step 6.

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

Requires [Node.js](https://nodejs.org) 22 or newer.

```bash
npm install
echo "TEAM_KEY=dev-key" > .dev.vars   # local-only team key
npm run dev                           # runs the Worker locally at http://localhost:8787, with a local database
npm test                              # API tests
```

```
extension/   Browser extension (Manifest V3): popup, settings page, icons
public/      The shared Article Depot page (served by Cloudflare as static files)
src/         The Worker: API (worker.js) and database access (store.js)
test/        API tests (run the Worker in Node against a SQLite stand-in for D1)
wrangler.jsonc   Cloudflare configuration
```

### API

All `/api` routes require an `X-Team-Key` header matching the `TEAM_KEY` secret.

| Method | Path | Body |
| --- | --- | --- |
| `GET` | `/api/articles` | |
| `POST` | `/api/articles` | `{ url, title?, description?, siteName?, flaggedBy, category, notes? }` |
| `PATCH` | `/api/articles/:id` | any of `{ category, notes, title }` |
| `DELETE` | `/api/articles/:id` | |

`category` is one of `option`, `inspiration` or `pass`.
