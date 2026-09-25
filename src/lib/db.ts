import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const DB_PATH = path.join(process.cwd(), 'data', 'gbp.db');

function init(): DatabaseSync {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- One Google account for the whole app: the agency's Workspace account that every client
    -- has added as a Manager on their profile. One token sees every managed location.
    CREATE TABLE IF NOT EXISTS google_connection (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      email TEXT,
      refresh_token TEXT NOT NULL,
      access_token TEXT,
      expires_at INTEGER NOT NULL DEFAULT 0,
      scope TEXT,
      connected_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- One row per Google login the app has been given. A person can manage Business Profiles
    -- under several Google accounts (Chao's twelve sit under two), and each account's locations
    -- are only reachable with that account's own token -- so the app holds them all and picks by
    -- the account a call names. The login is the sign-in email: what a person recognises in a list.
    -- Supersedes google_connection above, whose single row is copied across on first run.
    CREATE TABLE IF NOT EXISTS google_logins (
      login TEXT PRIMARY KEY,              -- the account's email, lower case
      name TEXT,
      refresh_token TEXT NOT NULL,
      access_token TEXT,
      expires_at INTEGER NOT NULL DEFAULT 0,
      scope TEXT,
      connected_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,                 -- 'locations/123'
      account TEXT NOT NULL,               -- 'accounts/456' (v4 endpoints need both ids)
      title TEXT NOT NULL,
      store_code TEXT,
      language_code TEXT,
      phone TEXT,
      website TEXT,
      description TEXT,
      address_json TEXT,
      latlng_json TEXT,
      hours_json TEXT,
      categories_json TEXT,
      services_json TEXT,
      attributes_json TEXT,
      labels_json TEXT,
      service_area_json TEXT,
      maps_uri TEXT,
      place_id TEXT,
      new_review_uri TEXT,
      raw_json TEXT,
      synced_at TEXT,

      -- operator configuration, never overwritten by a sync
      brand_voice TEXT,
      offered_services TEXT,               -- JSON array of strings
      service_areas TEXT,                  -- JSON array of strings (towns)
      site_slug TEXT,
      site_colour TEXT,
      auto_reply INTEGER NOT NULL DEFAULT 0,
      auto_post INTEGER NOT NULL DEFAULT 0,
      post_weekday INTEGER NOT NULL DEFAULT 1,   -- 0 Sun .. 6 Sat
      post_hour INTEGER NOT NULL DEFAULT 9,
      next_post_at TEXT,
      last_review_poll TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,                 -- Google reviewId
      location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      reviewer TEXT,
      rating INTEGER NOT NULL DEFAULT 0,
      comment TEXT,
      create_time TEXT,
      update_time TEXT,
      reply_comment TEXT,
      reply_time TEXT,
      draft_reply TEXT,
      draft_status TEXT NOT NULL DEFAULT 'none',   -- none | draft | posted | skipped | failed
      draft_error TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      topic_type TEXT NOT NULL DEFAULT 'STANDARD',
      cta_type TEXT,
      cta_url TEXT,
      media_url TEXT,
      angle TEXT,
      status TEXT NOT NULL DEFAULT 'draft',        -- draft | posted | failed | rejected
      google_name TEXT,
      error TEXT,
      posted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      field TEXT NOT NULL,                 -- description | categories | services
      proposal_json TEXT NOT NULL,
      rationale TEXT,
      status TEXT NOT NULL DEFAULT 'pending',      -- pending | applied | rejected | failed
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      applied_at TEXT
    );

    CREATE TABLE IF NOT EXISTS categories (
      name TEXT NOT NULL,                  -- 'categories/gcid:electrician'
      display_name TEXT NOT NULL,
      region TEXT NOT NULL,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (name, region)
    );

    CREATE TABLE IF NOT EXISTS site_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,                  -- home | service | area | service_area | contact
      slug TEXT NOT NULL,
      service TEXT,
      area TEXT,
      title TEXT NOT NULL,
      content_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (location_id, slug)
    );

    CREATE TABLE IF NOT EXISTS citation_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      canonical_json TEXT NOT NULL,        -- the NAP we compared against
      searched INTEGER NOT NULL DEFAULT 0,
      found INTEGER NOT NULL DEFAULT 0,
      matches INTEGER NOT NULL DEFAULT 0,
      mismatches INTEGER NOT NULL DEFAULT 0,
      ran_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS citations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES citation_runs(id) ON DELETE CASCADE,
      location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      domain TEXT NOT NULL,
      directory TEXT,                      -- key directory label if this is one of them
      page_title TEXT,
      name_found TEXT,
      phone_found TEXT,
      address_found TEXT,
      status TEXT NOT NULL,                -- match | mismatch | partial | not_listed | error
      issues TEXT,                         -- JSON array of strings
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Bulk prospecting: a batch of businesses to audit, each becoming a manual location.
    CREATE TABLE IF NOT EXISTS prospect_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      source TEXT NOT NULL,                -- csv | search
      budget INTEGER NOT NULL DEFAULT 10,  -- max audits this batch may run
      status TEXT NOT NULL DEFAULT 'idle', -- idle | running | done
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS prospects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL REFERENCES prospect_batches(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      street TEXT, town TEXT, postcode TEXT, phone TEXT, website TEXT, category TEXT,
      rating REAL, rating_count INTEGER,
      status TEXT NOT NULL DEFAULT 'queued',   -- queued | running | done | error | skipped
      location_id TEXT,
      score INTEGER, found INTEGER, mismatches INTEGER,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Google Q&A seeded by the owner: question + answer, posted together.
    -- Retired 2026-09-22 with Google's Q&A API; kept so old rows are not lost.
    CREATE TABLE IF NOT EXISTS qna (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',    -- draft | posted | failed | rejected
      google_name TEXT,
      error TEXT,
      posted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Photo queue: public URLs with captions, released to the profile on a schedule.
    CREATE TABLE IF NOT EXISTS photo_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'ADDITIONAL',
      caption TEXT,
      status TEXT NOT NULL DEFAULT 'queued',   -- queued | posted | failed
      error TEXT,
      posted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Business Profile Performance API, one row per location per day per metric.
    CREATE TABLE IF NOT EXISTS metrics (
      location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      metric TEXT NOT NULL,
      value INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (location_id, day, metric)
    );

    -- Serper results shared across businesses in the same market ("electrician in Swindon").
    CREATE TABLE IF NOT EXISTS serp_cache (
      key TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Customer searches tracked per business, and every check of them over time.
    CREATE TABLE IF NOT EXISTS keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      phrase TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',   -- primary | category | service | autocomplete | suggested | manual
      active INTEGER NOT NULL DEFAULT 1,
      intent TEXT,                             -- ok | wrong | thin, from the last check
      intent_note TEXT,
      suggestion TEXT,                         -- a clearer phrase when the results were the wrong kind of business
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS keywords_unique ON keywords (location_id, lower(phrase));

    CREATE TABLE IF NOT EXISTS keyword_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      ran_at TEXT NOT NULL DEFAULT (datetime('now')),
      keywords INTEGER NOT NULL DEFAULT 0,
      visibility REAL,
      summary_json TEXT
    );

    CREATE TABLE IF NOT EXISTS keyword_ranks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES keyword_runs(id) ON DELETE CASCADE,
      location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      keyword_id INTEGER,
      phrase TEXT NOT NULL,
      position INTEGER,                        -- NULL = not in the first 20
      total INTEGER NOT NULL DEFAULT 0,
      intent TEXT NOT NULL,
      note TEXT,
      results_json TEXT
    );

    -- Full Google profiles of competitors (all categories), shared across businesses for a week.
    CREATE TABLE IF NOT EXISTS competitor_profiles (
      cid TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Map grid: rank from a grid of points around the business, per search.
    CREATE TABLE IF NOT EXISTS grid_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      ran_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'running',  -- running | done | error
      size INTEGER NOT NULL,
      radius_mi REAL NOT NULL,
      zoom INTEGER NOT NULL,
      center_lat REAL NOT NULL,
      center_lng REAL NOT NULL,
      total INTEGER NOT NULL DEFAULT 0,
      done INTEGER NOT NULL DEFAULT 0,
      credits INTEGER NOT NULL DEFAULT 0,
      visibility REAL,
      summary_json TEXT,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS grid_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES grid_runs(id) ON DELETE CASCADE,
      keyword_id INTEGER,
      phrase TEXT NOT NULL,
      query TEXT NOT NULL,
      row INTEGER NOT NULL,
      col INTEGER NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      position INTEGER,                        -- NULL = not in the first 20 at this point
      total INTEGER NOT NULL DEFAULT 0,
      top_json TEXT,                           -- first three businesses shown here
      error TEXT
    );

    -- One score per business per week (the Monday it starts). See history.ts.
    CREATE TABLE IF NOT EXISTS usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT,                      -- null for agency-wide work, such as prospecting
      at TEXT NOT NULL DEFAULT (datetime('now')),
      source TEXT NOT NULL,                  -- serper | ai
      kind TEXT NOT NULL,                    -- the job it was spent on
      credits REAL NOT NULL DEFAULT 0,       -- Serper credits
      calls INTEGER NOT NULL DEFAULT 0,
      tokens INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS usage_at ON usage_log (at);

    CREATE TABLE IF NOT EXISTS score_history (
      location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      week TEXT NOT NULL,
      score INTEGER NOT NULL,
      coverage INTEGER NOT NULL,
      groups_json TEXT,
      taken_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (location_id, week)
    );

    -- Things that need a person, such as a new 1 or 2 star review. See alerts.ts.
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      ref TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      seen_at TEXT,
      ghl_status TEXT,
      ghl_detail TEXT,
      UNIQUE (kind, ref)
    );

    CREATE TABLE IF NOT EXISTS job_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job TEXT NOT NULL,
      location_id TEXT,
      status TEXT NOT NULL,                -- ok | error | skipped
      detail TEXT,
      ran_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // Additive migrations for columns added after the first release; safe to re-run.
  for (const [table, col, ddl] of [
    ['locations', 'ghl_contact_id', 'TEXT'],
    ['locations', 'ghl_pushed_at', 'TEXT'],
    ['locations', 'report_url', 'TEXT'],
    ['locations', 'photo_every_days', 'INTEGER NOT NULL DEFAULT 14'],
    ['locations', 'next_photo_at', 'TEXT'],
    ['locations', 'metrics_synced_at', 'TEXT'],
    ['locations', 'public_cid', 'TEXT'],
    ['locations', 'public_json', 'TEXT'],
    ['locations', 'public_synced_at', 'TEXT'],
    ['prospects', 'cid', 'TEXT'],
    ['prospect_batches', 'query', 'TEXT'],
    ['locations', 'benchmark_json', 'TEXT'],
    ['locations', 'benchmark_at', 'TEXT'],
    ['locations', 'benchmark_query', 'TEXT'],
    ['locations', 'keywords_weekly', 'INTEGER NOT NULL DEFAULT 1'],
    ['locations', 'next_keywords_at', 'TEXT'],
    ['locations', 'grid_monthly', 'INTEGER NOT NULL DEFAULT 0'],
    ['locations', 'next_grid_at', 'TEXT'],
    ['locations', 'photos_count', 'INTEGER'],
    ['locations', 'photos_customer_count', 'INTEGER'],
    ['locations', 'photos_latest_at', 'TEXT'],
    ['locations', 'photos_synced_at', 'TEXT'],
    ['locations', 'hold_low_stars', 'INTEGER NOT NULL DEFAULT 1'],
    // Where to centre a map when Google hands over no pin: worked out from the address once (see geo.ts).
    ['locations', 'geo_json', 'TEXT'],
    ['locations', 'geo_at', 'TEXT'],
  ] as const) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
  }

  // The one-row google_connection became google_logins when a second Google account was needed.
  // Carry the old row over so nobody has to reconnect, and leave it in place: it is harmless, and
  // a database that has been through this migration reads correctly either way.
  const old = db.prepare('SELECT * FROM google_connection WHERE id = 1').get() as
    | { email: string | null; refresh_token: string; access_token: string | null; expires_at: number; scope: string | null; connected_at: string }
    | undefined;
  if (old?.refresh_token) {
    db.prepare(
      `INSERT INTO google_logins (login, name, refresh_token, access_token, expires_at, scope, connected_at)
       VALUES (?,?,?,?,?,?,?) ON CONFLICT(login) DO NOTHING`,
    ).run(
      (old.email ?? 'default').toLowerCase(), old.email, old.refresh_token,
      old.access_token, old.expires_at, old.scope, old.connected_at,
    );
  }
  return db;
}

declare global {
  // eslint-disable-next-line no-var
  var __gbpDb: DatabaseSync | undefined;
}

export const db: DatabaseSync = globalThis.__gbpDb ?? (globalThis.__gbpDb = init());

// node:sqlite rows have a null prototype, which React refuses to serialise to client components.
// Spreading them into plain objects at the boundary keeps every caller simple.
export function all<T = any>(sql: string, ...params: any[]): T[] {
  return (db.prepare(sql).all(...params) as any[]).map(r => ({ ...r })) as T[];
}
export function one<T = any>(sql: string, ...params: any[]): T | undefined {
  const r = db.prepare(sql).get(...params) as any;
  return r ? ({ ...r } as T) : undefined;
}
export function run(sql: string, ...params: any[]) {
  return db.prepare(sql).run(...params);
}

/**
 * Give a location a new id everywhere it is referenced. Used when a business first added by hand
 * turns up in a Google sync: its keywords, maps, reports and citations move to the Google id instead
 * of the sync creating a second copy. Every table with a location_id column is updated, in one
 * transaction, with foreign-key checks deferred to the commit.
 */
export function rekeyLocation(from: string, to: string, account: string) {
  const tables = all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'locations' AND name NOT LIKE 'sqlite_%'`)
    .map(t => t.name)
    .filter(t => all<{ name: string }>(`PRAGMA table_info("${t}")`).some(c => c.name === 'location_id'));
  db.exec('BEGIN');
  try {
    db.exec('PRAGMA defer_foreign_keys = ON');
    run('UPDATE locations SET id = ?, account = ? WHERE id = ?', to, account, from);
    for (const t of tables) run(`UPDATE "${t}" SET location_id = ? WHERE location_id = ?`, to, from);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getSetting(key: string): string | undefined {
  return one<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)?.value;
}
export function setSetting(key: string, value: string) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}

export function log(job: string, status: 'ok' | 'error' | 'skipped', detail?: string, locationId?: string | null) {
  run('INSERT INTO job_log (job, location_id, status, detail) VALUES (?,?,?,?)', job, locationId ?? null, status, detail ?? null);
}

export function parse<T = any>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  // A stored JSON literal null (e.g. a profile with no categories) must fall back too, not crash callers.
  try { return (JSON.parse(s) ?? fallback) as T; } catch { return fallback; }
}
