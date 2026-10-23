use serde_json::{Value, json};
use tokio::sync::broadcast;

use crate::db::{ReportSummary, now};

/// Everything that flows through the in-process broadcast channel.
#[derive(Debug, Clone)]
pub enum Event {
    ReportUpserted(ReportSummary),
    ReportDeleted {
        project: String,
        slug: String,
    },
    ShareChanged {
        project: String,
        slug: String,
    },
    /// Internal: a share ws should say goodbye. Not exposed on `/api/ws`.
    ShareRevoked {
        token: String,
    },
    /// Internal: same as above, for natural expiry.
    ShareExpired {
        token: String,
    },
}

impl Event {
    /// The JSON payload for `/api/ws`, or `None` for internal-only events.
    pub fn global_json(&self) -> Option<Value> {
        match self {
            Event::ReportUpserted(report) => {
                Some(json!({"type": "report.upserted", "report": report}))
            }
            Event::ReportDeleted { project, slug } => {
                Some(json!({"type": "report.deleted", "project": project, "slug": slug}))
            }
            Event::ShareChanged { project, slug } => {
                Some(json!({"type": "share.changed", "project": project, "slug": slug}))
            }
            Event::ShareRevoked { .. } | Event::ShareExpired { .. } => None,
        }
    }
}

pub fn new_sender() -> broadcast::Sender<Event> {
    let (tx, _rx) = broadcast::channel(256);
    tx
}

pub fn hello() -> Value {
    json!({"type": "hello", "server_time": crate::db::fmt_time(now())})
}
