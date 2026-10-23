mod common;

use common::{INDEX_HTML, OWNER, RUNTIME_JS, SHARE_HTML, Server, doc};
use reqwest::Method;
use serde_json::json;

#[tokio::test]
async fn owner_routes_reject_missing_or_wrong_owner_header() {
    let srv = Server::start();
    let wrong = [
        None,
        Some(""),
        Some("wrong"),
        // A strict prefix / extension of the secret must not pass.
        Some(&OWNER[..OWNER.len() - 1]),
        Some("test-owner-secretx"),
    ];
    for path in [
        "/api/me",
        "/api/reports",
        "/api/projects",
        "/",
        "/r/p/s",
        "/s",
        "/c/",
    ] {
        for owner in wrong {
            let mut req = srv.anon(Method::GET, path);
            if let Some(owner) = owner {
                req = req.header("x-artifacts-owner", owner);
            }
            let resp = srv.send(req).await;
            assert_eq!(resp.status, 401, "{path} with owner {owner:?}");
            if path.starts_with("/api") {
                assert_eq!(resp.json(), json!({"error": "unauthorized"}), "{path}");
            } else {
                let ct = resp.header("content-type").unwrap_or_default();
                assert!(ct.starts_with("text/html"), "{path}: {ct}");
                assert!(
                    !resp.text().contains("spa-index-fixture"),
                    "{path} leaked SPA shell"
                );
            }
        }
    }
}

#[tokio::test]
async fn unauthenticated_writes_are_rejected_and_have_no_effect() {
    let srv = Server::start();
    let resp = srv
        .send(
            srv.anon(Method::PUT, "/api/reports/p/s/source")
                .body(doc("T", "<p>x</p>")),
        )
        .await;
    assert_eq!(resp.status, 401);
    assert_eq!(srv.get("/api/reports/p/s").await.status, 404);
}

#[tokio::test]
async fn owner_header_unlocks_api_and_spa_shell() {
    let srv = Server::start();
    let me = srv.get("/api/me").await;
    assert_eq!(me.status, 200);
    assert_eq!(me.json(), json!({"ok": true}));

    for path in ["/", "/r/p/s", "/list/p"] {
        let spa = srv.get(path).await;
        assert_eq!(spa.status, 200, "{path}");
        assert_eq!(spa.text(), INDEX_HTML, "{path}");
    }
}

#[tokio::test]
async fn public_prefixes_work_without_owner_header() {
    let srv = Server::start();

    let health = srv.get_anon("/healthz").await;
    assert_eq!((health.status, health.text().as_str()), (200, "ok"));

    let runtime = srv.get_anon("/_render/runtime.js").await;
    assert_eq!(runtime.status, 200);
    assert_eq!(runtime.text(), RUNTIME_JS);

    // Unknown share/cap: the public handler answers (404), not the owner gate (401).
    for path in ["/s/nope", "/s/nope/meta", "/c/nope/"] {
        assert_eq!(srv.get_anon(path).await.status, 404, "{path}");
    }

    srv.upsert("p", "s", "Public", "<p>public-body-marker</p>")
        .await;
    let token = srv.share("p", "s").await["token"]
        .as_str()
        .unwrap()
        .to_string();

    let shell = srv.get_anon(&format!("/s/{token}")).await;
    assert_eq!(shell.status, 200);
    assert_eq!(shell.text(), SHARE_HTML);

    let meta = srv.get_anon(&format!("/s/{token}/meta")).await;
    assert_eq!(meta.status, 200);
    assert_eq!(meta.json()["title"], "Public");

    let body = srv.get_anon(&format!("/s/{token}/body")).await;
    assert_eq!(body.status, 200);
    assert!(body.text().contains("public-body-marker"));

    let document = srv.get_anon(&format!("/c/{token}/")).await;
    assert_eq!(document.status, 200);
    assert!(document.text().contains("public-body-marker"));
}
