// A minimal stand-in for Cloudflare's D1 binding, backed by Node's built-in
// SQLite, so the Worker can be tested without the Cloudflare runtime.
import { DatabaseSync } from 'node:sqlite';

class Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new Statement(this.db, this.sql, params);
  }

  async first() {
    return this.db.prepare(this.sql).get(...this.params) ?? null;
  }

  async all() {
    return { results: this.db.prepare(this.sql).all(...this.params), success: true };
  }

  async run() {
    const info = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(info.changes) } };
  }
}

export class FakeD1 {
  constructor(file = ':memory:') {
    this.db = new DatabaseSync(file);
  }

  prepare(sql) {
    return new Statement(this.db, sql);
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}
