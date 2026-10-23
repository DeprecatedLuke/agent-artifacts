use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde_json::json;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

use crate::App;

/// Paths reachable without the `X-Artifacts-Owner` header.
pub fn is_public(path: &str) -> bool {
    fn under(path: &str, prefix: &str) -> bool {
        path.strip_prefix(prefix)
            .is_some_and(|rest| !rest.is_empty() && !rest.starts_with('/'))
    }
    path == "/healthz"
        || path == "/favicon.svg"
        || under(path, "/s/")
        || under(path, "/c/")
        || under(path, "/_render/")
        || under(path, "/assets/")
}

fn unauthorized(is_api: bool) -> Response {
    if is_api {
        (
            StatusCode::UNAUTHORIZED,
            axum::Json(json!({"error": "unauthorized"})),
        )
            .into_response()
    } else {
        (
            StatusCode::UNAUTHORIZED,
            [("content-type", "text/html; charset=utf-8")],
            "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>401 Unauthorized</title>\
             <body style=\"font-family: system-ui, sans-serif; padding: 2rem\"><h1>401 Unauthorized</h1>\
             <p>This page requires authentication.</p></body></html>",
        )
            .into_response()
    }
}

/// Constant-time owner check. Compares SHA-256 digests so the comparison is
/// fixed-width regardless of the header length.
pub async fn owner_gate(State(app): State<App>, req: Request, next: Next) -> Response {
    let path = req.uri().path().to_string();
    if is_public(&path) {
        return next.run(req).await;
    }

    let is_api = path.starts_with("/api");
    let presented = req
        .headers()
        .get("x-artifacts-owner")
        .map(|v| v.as_bytes())
        .unwrap_or_default();

    let given = Sha256::digest(presented);
    let expected = Sha256::digest(app.cfg.owner_secret.as_bytes());
    if bool::from(given.ct_eq(&expected)) {
        next.run(req).await
    } else {
        unauthorized(is_api)
    }
}
