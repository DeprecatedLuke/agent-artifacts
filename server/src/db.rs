use std::path::Path;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result, anyhow};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS reports (
    project     TEXT NOT NULL,
    slug        TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    source      TEXT NOT NULL,
    text        TEXT NOT NULL,
    rev         INTEGER NOT NULL,
    size        INTEGER NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (project, slug)
);
CREATE TABLE IF NOT EXISTS assets (
    project      TEXT NOT NULL,
    slug         TEXT NOT NULL,
    name         TEXT NOT NULL,
    sha256       TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size         INTEGER NOT NULL,
    created_at   TEXT NOT NULL,
    PRIMARY KEY (project, slug, name)
);
CREATE INDEX IF NOT EXISTS assets_sha ON assets (sha256);
CREATE TABLE IF NOT EXISTS shares (
    token      TEXT PRIMARY KEY,
    project    TEXT NOT NULL,
    slug       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS shares_report ON shares (project, slug);
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
";

/// A single SQLite connection behind a mutex; every query runs on the blocking pool.
#[derive(Clone)]
pub struct Db {
    conn: Arc<Mutex<Connection>>,
}

#[derive(Debug, Clone)]
pub struct ReportRow {
    pub project: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub source: String,
    pub text: String,
    pub rev: i64,
    pub size: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReportSummary {
    pub project: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub rev: i64,
    pub size: i64,
    pub created_at: String,
    pub updated_at: String,
}

impl From<&ReportRow> for ReportSummary {
    fn from(r: &ReportRow) -> Self {
        Self {
            project: r.project.clone(),
            slug: r.slug.clone(),
            title: r.title.clone(),
            description: r.description.clone(),
            rev: r.rev,
            size: r.size,
            created_at: r.created_at.clone(),
            updated_at: r.updated_at.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectAgg {
    pub project: String,
    pub count: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct AssetRow {
    pub project: String,
    pub slug: String,
    pub name: String,
    pub sha256: String,
    pub content_type: String,
    pub size: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AssetJson {
    pub name: String,
    pub content_type: String,
    pub size: i64,
    pub sha256: String,
    pub created_at: String,
}

impl From<&AssetRow> for AssetJson {
    fn from(a: &AssetRow) -> Self {
        Self {
            name: a.name.clone(),
            content_type: a.content_type.clone(),
            size: a.size,
            sha256: a.sha256.clone(),
            created_at: a.created_at.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ShareRow {
    pub token: String,
    pub project: String,
    pub slug: String,
    pub created_at: String,
    pub expires_at: String,
    pub revoked_at: Option<String>,
}

impl ShareRow {
    pub fn expires(&self) -> Option<OffsetDateTime> {
        parse_time(&self.expires_at)
    }

    pub fn is_active(&self, now: OffsetDateTime) -> bool {
        self.revoked_at.is_none() && self.expires().is_some_and(|e| e > now)
    }
}

#[derive(Debug)]
pub enum PutResult {
    Created(ReportRow),
    Updated(ReportRow),
    Unchanged(ReportRow),
    RevMismatch { current_rev: i64 },
    Exists { current_rev: i64 },
}

pub fn now() -> OffsetDateTime {
    OffsetDateTime::now_utc()
}

pub fn fmt_time(t: OffsetDateTime) -> String {
    t.format(&Rfc3339).unwrap_or_default()
}

pub fn parse_time(s: &str) -> Option<OffsetDateTime> {
    OffsetDateTime::parse(s, &Rfc3339).ok()
}

fn row_from(r: &rusqlite::Row<'_>) -> rusqlite::Result<ReportRow> {
    Ok(ReportRow {
        project: r.get(0)?,
        slug: r.get(1)?,
        title: r.get(2)?,
        description: r.get(3)?,
        source: r.get(4)?,
        text: r.get(5)?,
        rev: r.get(6)?,
        size: r.get(7)?,
        created_at: r.get(8)?,
        updated_at: r.get(9)?,
    })
}

const REPORT_COLS: &str =
    "project, slug, title, description, source, text, rev, size, created_at, updated_at";

impl Db {
    pub fn open(data_dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(data_dir)
            .with_context(|| format!("creating data dir {}", data_dir.display()))?;
        let path = data_dir.join("agent-reports.db");
        let conn =
            Connection::open(&path).with_context(|| format!("opening {}", path.display()))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.busy_timeout(std::time::Duration::from_secs(10))?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub async fn call<T, F>(&self, f: F) -> Result<T>
    where
        T: Send + 'static,
        F: FnOnce(&mut Connection) -> Result<T> + Send + 'static,
    {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let mut guard = conn
                .lock()
                .map_err(|_| anyhow!("database mutex poisoned"))?;
            f(&mut guard)
        })
        .await?
    }

    // ---------- meta ----------

    pub fn get_meta(c: &Connection, key: &str) -> Result<Option<String>> {
        let v = c
            .query_row("SELECT value FROM meta WHERE key = ?1", params![key], |r| {
                r.get::<_, String>(0)
            })
            .optional()?;
        Ok(v)
    }

    pub fn set_meta(c: &Connection, key: &str, value: &str) -> Result<()> {
        c.execute(
            "INSERT INTO meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    // ---------- reports ----------

    pub fn get_report(c: &Connection, project: &str, slug: &str) -> Result<Option<ReportRow>> {
        let sql = format!("SELECT {REPORT_COLS} FROM reports WHERE project = ?1 AND slug = ?2");
        let row = c
            .query_row(&sql, params![project, slug], row_from)
            .optional()?;
        Ok(row)
    }

    pub fn list_reports(c: &Connection, project: Option<&str>) -> Result<Vec<ReportSummary>> {
        let sql = format!(
            "SELECT {REPORT_COLS} FROM reports {} ORDER BY updated_at DESC, project ASC, slug ASC",
            if project.is_some() {
                "WHERE project = ?1"
            } else {
                ""
            }
        );
        let mut stmt = c.prepare(&sql)?;
        let map = |r: &rusqlite::Row<'_>| row_from(r).map(|row| ReportSummary::from(&row));
        let rows: Vec<ReportSummary> = match project {
            Some(p) => stmt
                .query_map(params![p], map)?
                .collect::<rusqlite::Result<_>>()?,
            None => stmt.query_map([], map)?.collect::<rusqlite::Result<_>>()?,
        };
        Ok(rows)
    }

    pub fn list_projects(c: &Connection) -> Result<Vec<ProjectAgg>> {
        let mut stmt = c.prepare(
            "SELECT project, COUNT(*) AS n, MAX(updated_at) AS u
             FROM reports GROUP BY project ORDER BY u DESC, project ASC",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(ProjectAgg {
                    project: r.get(0)?,
                    count: r.get(1)?,
                    updated_at: r.get(2)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Insert or update a report. `if_match` is the raw rev the caller expects.
    /// The markdown `text` column is derived here so it always matches `rev`/`updated_at`.
    #[allow(clippy::too_many_arguments)]
    pub fn put_report(
        c: &mut Connection,
        project: &str,
        slug: &str,
        title: &str,
        description: &str,
        source: &str,
        markdown: &str,
        if_match: Option<i64>,
        if_none_match: bool,
        at: OffsetDateTime,
    ) -> Result<PutResult> {
        let ts = fmt_time(at);
        let size = source.len() as i64;
        let tx = c.transaction()?;
        let existing = {
            let sql = format!("SELECT {REPORT_COLS} FROM reports WHERE project = ?1 AND slug = ?2");
            tx.query_row(&sql, params![project, slug], row_from)
                .optional()?
        };

        if let Some(expected) = if_match {
            match &existing {
                Some(row) if row.rev == expected => {}
                Some(row) => {
                    return Ok(PutResult::RevMismatch {
                        current_rev: row.rev,
                    });
                }
                None => return Ok(PutResult::RevMismatch { current_rev: 0 }),
            }
        }
        if if_none_match && let Some(row) = &existing {
            return Ok(PutResult::Exists {
                current_rev: row.rev,
            });
        }

        if let Some(row) = &existing {
            if row.source == source {
                return Ok(PutResult::Unchanged(row.clone()));
            }
            let rev = row.rev + 1;
            let created_at = row.created_at.clone();
            let text = crate::text::compose(project, title, description, &ts, rev, markdown);
            tx.execute(
                "UPDATE reports SET title = ?3, description = ?4, source = ?5, text = ?6,
                    rev = ?7, size = ?8, updated_at = ?9
                 WHERE project = ?1 AND slug = ?2",
                params![
                    project,
                    slug,
                    title,
                    description,
                    source,
                    text,
                    rev,
                    size,
                    ts
                ],
            )?;
            tx.commit()?;
            Ok(PutResult::Updated(ReportRow {
                project: project.to_string(),
                slug: slug.to_string(),
                title: title.to_string(),
                description: description.to_string(),
                source: source.to_string(),
                text,
                rev,
                size,
                created_at,
                updated_at: ts,
            }))
        } else {
            let text = crate::text::compose(project, title, description, &ts, 1, markdown);
            tx.execute(
                "INSERT INTO reports (project, slug, title, description, source, text, rev, size, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8, ?8)",
                params![project, slug, title, description, source, text, size, ts],
            )?;
            tx.commit()?;
            Ok(PutResult::Created(ReportRow {
                project: project.to_string(),
                slug: slug.to_string(),
                title: title.to_string(),
                description: description.to_string(),
                source: source.to_string(),
                text,
                rev: 1,
                size,
                created_at: ts.clone(),
                updated_at: ts,
            }))
        }
    }

    /// Returns the sha256 blobs that are no longer referenced by any asset row.
    pub fn delete_report(c: &mut Connection, project: &str, slug: &str) -> Result<Vec<String>> {
        let tx = c.transaction()?;
        let shas = {
            let mut stmt =
                tx.prepare("SELECT DISTINCT sha256 FROM assets WHERE project = ?1 AND slug = ?2")?;
            stmt.query_map(params![project, slug], |r| r.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        tx.execute(
            "DELETE FROM assets WHERE project = ?1 AND slug = ?2",
            params![project, slug],
        )?;
        tx.execute(
            "DELETE FROM shares WHERE project = ?1 AND slug = ?2",
            params![project, slug],
        )?;
        tx.execute(
            "DELETE FROM reports WHERE project = ?1 AND slug = ?2",
            params![project, slug],
        )?;
        let mut unreferenced = Vec::new();
        for sha in shas {
            let n: i64 = tx.query_row(
                "SELECT COUNT(*) FROM assets WHERE sha256 = ?1",
                params![sha],
                |r| r.get(0),
            )?;
            if n == 0 {
                unreferenced.push(sha);
            }
        }
        tx.commit()?;
        Ok(unreferenced)
    }

    // ---------- assets ----------

    pub fn upsert_asset(c: &Connection, asset: &AssetRow) -> Result<()> {
        c.execute(
            "INSERT INTO assets (project, slug, name, sha256, content_type, size, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(project, slug, name) DO UPDATE SET
                sha256 = excluded.sha256,
                content_type = excluded.content_type,
                size = excluded.size,
                created_at = excluded.created_at",
            params![
                asset.project,
                asset.slug,
                asset.name,
                asset.sha256,
                asset.content_type,
                asset.size,
                asset.created_at
            ],
        )?;
        Ok(())
    }

    pub fn list_assets(c: &Connection, project: &str, slug: &str) -> Result<Vec<AssetRow>> {
        let mut stmt = c.prepare(
            "SELECT project, slug, name, sha256, content_type, size, created_at
             FROM assets WHERE project = ?1 AND slug = ?2 ORDER BY name ASC",
        )?;
        let rows = stmt
            .query_map(params![project, slug], |r| {
                Ok(AssetRow {
                    project: r.get(0)?,
                    slug: r.get(1)?,
                    name: r.get(2)?,
                    sha256: r.get(3)?,
                    content_type: r.get(4)?,
                    size: r.get(5)?,
                    created_at: r.get(6)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn get_asset(
        c: &Connection,
        project: &str,
        slug: &str,
        name: &str,
    ) -> Result<Option<AssetRow>> {
        let row = c
            .query_row(
                "SELECT project, slug, name, sha256, content_type, size, created_at
                 FROM assets WHERE project = ?1 AND slug = ?2 AND name = ?3",
                params![project, slug, name],
                |r| {
                    Ok(AssetRow {
                        project: r.get(0)?,
                        slug: r.get(1)?,
                        name: r.get(2)?,
                        sha256: r.get(3)?,
                        content_type: r.get(4)?,
                        size: r.get(5)?,
                        created_at: r.get(6)?,
                    })
                },
            )
            .optional()?;
        Ok(row)
    }

    /// Deletes the row, returns the blob hash if this was the last reference.
    pub fn delete_asset(
        c: &mut Connection,
        project: &str,
        slug: &str,
        name: &str,
    ) -> Result<Option<Option<String>>> {
        let tx = c.transaction()?;
        let sha = tx
            .query_row(
                "SELECT sha256 FROM assets WHERE project = ?1 AND slug = ?2 AND name = ?3",
                params![project, slug, name],
                |r| r.get::<_, String>(0),
            )
            .optional()?;
        let Some(sha) = sha else {
            return Ok(None);
        };
        tx.execute(
            "DELETE FROM assets WHERE project = ?1 AND slug = ?2 AND name = ?3",
            params![project, slug, name],
        )?;
        let n: i64 = tx.query_row(
            "SELECT COUNT(*) FROM assets WHERE sha256 = ?1",
            params![sha],
            |r| r.get(0),
        )?;
        tx.commit()?;
        Ok(Some(if n == 0 { Some(sha) } else { None }))
    }

    // ---------- shares ----------

    pub fn create_share(c: &Connection, share: &ShareRow) -> Result<()> {
        c.execute(
            "INSERT INTO shares (token, project, slug, created_at, expires_at, revoked_at)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL)",
            params![
                share.token,
                share.project,
                share.slug,
                share.created_at,
                share.expires_at
            ],
        )?;
        Ok(())
    }

    pub fn shares_for(c: &Connection, project: &str, slug: &str) -> Result<Vec<ShareRow>> {
        let mut stmt = c.prepare(
            "SELECT token, project, slug, created_at, expires_at, revoked_at
             FROM shares WHERE project = ?1 AND slug = ?2 ORDER BY created_at DESC",
        )?;
        let rows = stmt
            .query_map(params![project, slug], |r| {
                Ok(ShareRow {
                    token: r.get(0)?,
                    project: r.get(1)?,
                    slug: r.get(2)?,
                    created_at: r.get(3)?,
                    expires_at: r.get(4)?,
                    revoked_at: r.get(5)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn get_share(c: &Connection, token: &str) -> Result<Option<ShareRow>> {
        let row = c
            .query_row(
                "SELECT token, project, slug, created_at, expires_at, revoked_at
                 FROM shares WHERE token = ?1",
                params![token],
                |r| {
                    Ok(ShareRow {
                        token: r.get(0)?,
                        project: r.get(1)?,
                        slug: r.get(2)?,
                        created_at: r.get(3)?,
                        expires_at: r.get(4)?,
                        revoked_at: r.get(5)?,
                    })
                },
            )
            .optional()?;
        Ok(row)
    }

    /// Revokes an existing, not-yet-revoked share. Returns the row on success.
    pub fn revoke_share(
        c: &mut Connection,
        token: &str,
        at: OffsetDateTime,
    ) -> Result<Option<ShareRow>> {
        let ts = fmt_time(at);
        let changed = c.execute(
            "UPDATE shares SET revoked_at = ?2 WHERE token = ?1 AND revoked_at IS NULL",
            params![token, ts],
        )?;
        if changed == 0 {
            return Ok(None);
        }
        Self::get_share(c, token)
    }
}
