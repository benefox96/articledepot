'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CATEGORIES = ['option', 'inspiration', 'pass'];

const LIMITS = {
  url: 2048,
  title: 500,
  description: 2000,
  siteName: 200,
  flaggedBy: 100,
  notes: 5000,
};

class ValidationError extends Error {}

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

function cleanCategory(value) {
  if (!CATEGORIES.includes(value)) {
    throw new ValidationError(`category must be one of: ${CATEGORIES.join(', ')}`);
  }
  return value;
}

/**
 * A tiny JSON-file backed store. All writes go through a temp file + rename so
 * a crash mid-write never leaves a half-written database behind.
 */
class Store {
  constructor(file) {
    this.file = file;
    this.articles = [];
    this.load();
  }

  load() {
    if (!fs.existsSync(this.file)) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      this.save();
      return;
    }
    const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    this.articles = Array.isArray(data.articles) ? data.articles : [];
  }

  save() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ articles: this.articles }, null, 2));
    fs.renameSync(tmp, this.file);
  }

  list() {
    return [...this.articles].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id) {
    return this.articles.find((a) => a.id === id);
  }

  /**
   * Adds an article. If the same person already flagged the same URL, their
   * existing entry is updated instead of creating a duplicate.
   * Returns { article, created }.
   */
  add(input) {
    const fields = {
      url: cleanUrl(input.url),
      title: cleanString(input.title, 'title'),
      description: cleanString(input.description, 'description'),
      siteName: cleanString(input.siteName, 'siteName'),
      flaggedBy: cleanString(input.flaggedBy, 'flaggedBy', { required: true }),
      category: cleanCategory(input.category),
      notes: cleanString(input.notes, 'notes'),
    };
    if (!fields.title) fields.title = fields.url;

    const now = new Date().toISOString();
    const existing = this.articles.find(
      (a) => a.url === fields.url && a.flaggedBy.toLowerCase() === fields.flaggedBy.toLowerCase()
    );
    if (existing) {
      Object.assign(existing, fields, { updatedAt: now });
      this.save();
      return { article: existing, created: false };
    }

    const article = { id: crypto.randomUUID(), ...fields, createdAt: now, updatedAt: now };
    this.articles.push(article);
    this.save();
    return { article, created: true };
  }

  /** Updates the editable fields (category, notes, title) of an article. */
  update(id, input) {
    const article = this.get(id);
    if (!article) return null;
    const changes = {};
    if (input.category !== undefined) changes.category = cleanCategory(input.category);
    if (input.notes !== undefined) changes.notes = cleanString(input.notes, 'notes');
    if (input.title !== undefined) {
      changes.title = cleanString(input.title, 'title') || article.url;
    }
    Object.assign(article, changes, { updatedAt: new Date().toISOString() });
    this.save();
    return article;
  }

  remove(id) {
    const index = this.articles.findIndex((a) => a.id === id);
    if (index === -1) return false;
    this.articles.splice(index, 1);
    this.save();
    return true;
  }
}

module.exports = { Store, ValidationError, CATEGORIES };
