// Article storage on Cloudflare D1 (a hosted SQLite database).

export const CATEGORIES = ['option', 'inspiration', 'pass'];

const LIMITS = {
  url: 2048,
  title: 500,
  description: 2000,
  siteName: 200,
  flaggedBy: 100,
  notes: 5000,
};

export class ValidationError extends Error {}

function cleanString(value, field, { required = false } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`);
  value = value.trim();
  if (required && !value) throw new ValidationError(`${field} is required`);
  if (value.length > LIMITS[field]) throw new ValidationError(`${field} is too long`);
  return value;
}

function cleanUrl(value) {
  const raw = cleanString(value, 'url', { required: true });
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ValidationError('url is not a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ValidationError('url must be an http(s) link');
  }
  return parsed.toString();
}

function cleanBoolean(value, field) {
  if (typeof value !== 'boolean') throw new ValidationError(`${field} must be true or false`);
  return value;
}

function cleanCategory(value) {
  if (!CATEGORIES.includes(value)) {
    throw new ValidationError(`category must be one of: ${CATEGORIES.join(', ')}`);
  }
  return value;
}

// The table is created on first use, so a brand new database needs no setup step.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    site_name TEXT NOT NULL DEFAULT '',
    flagged_by TEXT NOT NULL,
    category TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    discuss INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS articles_url_person ON articles (url, flagged_by COLLATE NOCASE)',
];

// Columns added after the first release. Databases created before then get them on first use.
const ADDED_COLUMNS = [
  'ALTER TABLE articles ADD COLUMN discuss INTEGER NOT NULL DEFAULT 0',
];

function toArticle(row) {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    description: row.description,
    siteName: row.site_name,
    flaggedBy: row.flagged_by,
    category: row.category,
    notes: row.notes,
    discuss: Boolean(row.discuss),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class Store {
  constructor(db) {
    this.db = db;
  }

  async ready() {
    if (!this.schemaReady) {
      this.schemaReady = this.migrate().catch((err) => {
        this.schemaReady = null;
        throw err;
      });
    }
    return this.schemaReady;
  }

  async migrate() {
    await this.db.batch(SCHEMA.map((sql) => this.db.prepare(sql)));
    for (const sql of ADDED_COLUMNS) {
      try {
        await this.db.prepare(sql).run();
      } catch (err) {
        if (!/duplicate column/i.test(String(err?.message))) throw err;
      }
    }
  }

  async list() {
    await this.ready();
    const { results } = await this.db
      .prepare('SELECT * FROM articles ORDER BY created_at DESC')
      .all();
    return results.map(toArticle);
  }

  async get(id) {
    await this.ready();
    const row = await this.db.prepare('SELECT * FROM articles WHERE id = ?').bind(id).first();
    return row ? toArticle(row) : null;
  }

  /**
   * Adds an article. If the same person already flagged the same URL, their
   * existing entry is updated instead of creating a duplicate.
   * Returns { article, created }.
   */
  async add(input) {
    const fields = {
      url: cleanUrl(input.url),
      title: cleanString(input.title, 'title'),
      description: cleanString(input.description, 'description'),
      siteName: cleanString(input.siteName, 'siteName'),
      flaggedBy: cleanString(input.flaggedBy, 'flaggedBy', { required: true }),
      category: cleanCategory(input.category),
      notes: cleanString(input.notes, 'notes'),
    };
    // Only set when given, so re-flagging an article doesn't take it off the To Discuss shelf.
    const discuss = input.discuss === undefined ? undefined : cleanBoolean(input.discuss, 'discuss');
    if (!fields.title) fields.title = fields.url;

    await this.ready();
    const now = new Date().toISOString();
    const existing = await this.db
      .prepare('SELECT id, discuss FROM articles WHERE url = ? AND flagged_by = ? COLLATE NOCASE')
      .bind(fields.url, fields.flaggedBy)
      .first();

    if (existing) {
      await this.db
        .prepare(
          `UPDATE articles SET title = ?, description = ?, site_name = ?, flagged_by = ?,
             category = ?, notes = ?, discuss = ?, updated_at = ? WHERE id = ?`
        )
        .bind(fields.title, fields.description, fields.siteName, fields.flaggedBy,
          fields.category, fields.notes, discuss === undefined ? existing.discuss : Number(discuss),
          now, existing.id)
        .run();
      return { article: await this.get(existing.id), created: false };
    }

    const id = crypto.randomUUID();
    await this.db
      .prepare(
        `INSERT INTO articles (id, url, title, description, site_name, flagged_by, category,
           notes, discuss, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, fields.url, fields.title, fields.description, fields.siteName, fields.flaggedBy,
        fields.category, fields.notes, Number(discuss ?? false), now, now)
      .run();
    return { article: await this.get(id), created: true };
  }

  /** Updates the editable fields (category, notes, title, discuss) of an article. */
  async update(id, input) {
    const article = await this.get(id);
    if (!article) return null;
    const category = input.category !== undefined ? cleanCategory(input.category) : article.category;
    const notes = input.notes !== undefined ? cleanString(input.notes, 'notes') : article.notes;
    const title = input.title !== undefined
      ? cleanString(input.title, 'title') || article.url
      : article.title;
    const discuss = input.discuss !== undefined ? cleanBoolean(input.discuss, 'discuss') : article.discuss;
    await this.db
      .prepare(
        'UPDATE articles SET category = ?, notes = ?, title = ?, discuss = ?, updated_at = ? WHERE id = ?'
      )
      .bind(category, notes, title, Number(discuss), new Date().toISOString(), id)
      .run();
    return this.get(id);
  }

  async remove(id) {
    await this.ready();
    const result = await this.db.prepare('DELETE FROM articles WHERE id = ?').bind(id).run();
    return result.meta.changes > 0;
  }
}
