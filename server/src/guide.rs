use sha2::{Digest, Sha256};

use crate::{
    App,
    db::{self, Db, PutResult, ReportSummary},
    events::Event,
    source,
};

const GUIDE_PROJECT: &str = "agent-reports";
const GUIDE_SLUG: &str = "guide";
const GUIDE_HASH_KEY: &str = "guide_hash";

/// Upsert `docs/guide.html` as `agent-reports/guide` when it changed since the last seed.
pub async fn seed(app: &App) {
    let path = app.cfg.guide_path.clone();
    let source_text = match tokio::fs::read_to_string(&path).await {
        Ok(text) => text,
        Err(err) => {
            tracing::warn!(
                path = %path.display(),
                error = %err,
                "guide source missing; skipping guide seeding"
            );
            return;
        }
    };

    let hash = hex::encode(Sha256::digest(source_text.as_bytes()));
    let previous = match app.db.call(|c| Db::get_meta(c, GUIDE_HASH_KEY)).await {
        Ok(v) => v,
        Err(err) => {
            tracing::warn!(error = %err, "reading guide hash failed; skipping guide seeding");
            return;
        }
    };
    if previous.as_deref() == Some(hash.as_str()) {
        tracing::debug!("guide unchanged since last seed");
        return;
    }

    let parsed = match source::parse_and_validate(&source_text, &app.icons) {
        Ok(parsed) => parsed,
        Err(problems) => {
            tracing::warn!(
                count = problems.len(),
                "guide failed validation; skipping guide seeding"
            );
            for problem in problems {
                tracing::warn!(line = ?problem.line, "guide problem: {}", problem.message);
            }
            return;
        }
    };

    let markdown = app
        .md
        .convert(&source::fragment_html(&parsed.body))
        .unwrap_or_default();
    let at = db::now();
    let result = app
        .db
        .call({
            let (title, description) = (parsed.title.clone(), parsed.description.clone());
            let source_text = source_text.clone();
            move |c| {
                Db::put_report(
                    c,
                    GUIDE_PROJECT,
                    GUIDE_SLUG,
                    &title,
                    &description,
                    &source_text,
                    &markdown,
                    None,
                    false,
                    at,
                )
            }
        })
        .await;

    match result {
        Ok(PutResult::Created(row)) | Ok(PutResult::Updated(row)) => {
            let _ = app
                .events
                .send(Event::ReportUpserted(ReportSummary::from(&row)));
            store_hash(app, &hash).await;
            tracing::info!(rev = row.rev, "seeded agent-reports/guide");
        }
        Ok(PutResult::Unchanged(_)) => {
            store_hash(app, &hash).await;
        }
        Ok(_) => {
            tracing::warn!("guide upsert returned an unexpected precondition result");
        }
        Err(err) => {
            tracing::warn!(error = %err, "guide upsert failed");
        }
    }
}

async fn store_hash(app: &App, hash: &str) {
    let hash = hash.to_string();
    if let Err(err) = app
        .db
        .call(move |c| Db::set_meta(c, GUIDE_HASH_KEY, &hash))
        .await
    {
        tracing::warn!(error = %err, "storing guide hash failed");
    }
}
