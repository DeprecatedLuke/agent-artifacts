mod common;

use common::{PUBLIC_URL, Server, doc};
use reqwest::Method;
use serde_json::{Value, json};

fn problem_lines(body: &Value) -> Vec<Option<u64>> {
    body["problems"]
        .as_array()
        .expect("problems array")
        .iter()
        .map(|p| p["line"].as_u64())
        .collect()
}

#[tokio::test]
async fn revisions_start_at_one_and_increment_only_on_change() {
    let srv = Server::start();

    let created = srv.put_source("p", "s", &doc("T", "<p>one</p>")).await;
    assert_eq!(created.status, 200);
    let created = created.json();
    assert_eq!(created["created"], true);
    assert_eq!(created["report"]["rev"], 1);
    assert_eq!(created["url"], format!("{PUBLIC_URL}/r/p/s"));

    let updated = srv
        .put_source("p", "s", &doc("T", "<p>two</p>"))
        .await
        .json();
    assert_eq!(updated["created"], false);
    assert_eq!(updated["report"]["rev"], 2);
    assert_eq!(
        updated["report"]["created_at"], created["report"]["created_at"],
        "created_at survives updates"
    );

    let same = srv.put_source("p", "s", &doc("T", "<p>two</p>")).await;
    assert_eq!(same.status, 200);
    let same = same.json();
    assert_eq!(same["created"], false);
    assert_eq!(
        same["report"]["rev"], 2,
        "byte-identical PUT must not bump rev"
    );
    assert_eq!(
        same["report"]["updated_at"],
        updated["report"]["updated_at"]
    );

    let source = srv.get("/api/reports/p/s/source").await;
    assert_eq!(source.header("etag"), Some("\"2\""));
    assert_eq!(source.header("x-artifacts-rev"), Some("2"));
}

#[tokio::test]
async fn conditional_puts_enforce_preconditions() {
    let srv = Server::start();
    let put = |headers: &'static [(&'static str, &'static str)], body: &'static str| {
        let mut req = srv
            .owner(Method::PUT, "/api/reports/p/s/source")
            .body(doc("T", body));
        for (k, v) in headers {
            req = req.header(*k, *v);
        }
        srv.send(req)
    };

    // If-Match on a missing report.
    let missing = put(&[("if-match", "\"1\"")], "<p>a</p>").await;
    assert_eq!(missing.status, 412);
    assert_eq!(missing.json()["error"], "rev_mismatch");
    assert_eq!(
        srv.get("/api/reports/p/s").await.status,
        404,
        "412 must not create"
    );

    // If-None-Match: * on a missing report creates it.
    let first = put(&[("if-none-match", "*")], "<p>a</p>").await;
    assert_eq!(first.status, 200);
    assert_eq!(first.json()["report"]["rev"], 1);

    // If-None-Match: * on an existing report, even with a new body.
    let exists = put(&[("if-none-match", "*")], "<p>b</p>").await;
    assert_eq!(exists.status, 412);
    assert_eq!(exists.json()["current_rev"], 1);

    // Matching If-Match succeeds.
    let second = put(&[("if-match", "\"1\"")], "<p>b</p>").await;
    assert_eq!(second.status, 200);
    assert_eq!(second.json()["report"]["rev"], 2);

    // Stale If-Match is refused with the current rev, and nothing changes.
    let stale = put(&[("if-match", "\"1\"")], "<p>c</p>").await;
    assert_eq!(stale.status, 412);
    assert_eq!(
        stale.json(),
        json!({"error": "rev_mismatch", "current_rev": 2})
    );
    let source = srv.get("/api/reports/p/s/source").await;
    assert_eq!(source.text(), doc("T", "<p>b</p>"));
}

#[tokio::test]
async fn source_is_returned_byte_for_byte() {
    let srv = Server::start();
    let cases = [
        (
            "crlf",
            "---\r\ntitle: CRLF  \r\n---\r\n<p>a</p>  \r\n\r\n<p>b</p>\t\r\n",
        ),
        ("no-final-newline", "---\ntitle: T\n---\n<p>end</p>"),
        (
            "trailing-blank-lines",
            "---\ntitle: T\n---\n\n<p>x</p>   \n\n\n",
        ),
        (
            "unicode",
            "---\ntitle: Ünïcødé — “quoted”\ndescription: |\n  line one\n  line two\n---\n<p>日本語 · Ünïcødé — “quoted”</p>\n",
        ),
    ];
    for (slug, source) in cases {
        let put = srv.put_source("p", slug, source).await;
        assert_eq!(put.status, 200, "{slug}: {}", put.text());
        assert_eq!(put.json()["report"]["size"], source.len(), "{slug}");
        let got = srv.get(&format!("/api/reports/p/{slug}/source")).await;
        assert_eq!(got.status, 200);
        assert!(
            got.header("content-type")
                .unwrap()
                .starts_with("text/plain")
        );
        assert_eq!(got.body, source.as_bytes(), "{slug}");
    }

    let unicode = srv.get("/api/reports/p/unicode").await.json();
    assert_eq!(unicode["title"], "Ünïcødé — “quoted”");
    assert_eq!(unicode["description"], "line one\nline two");
    let crlf = srv.get("/api/reports/p/crlf").await.json();
    assert_eq!(crlf["title"], "CRLF");
}

/// Frontmatter spanning lines 1-6, so the body starts at line 7 of the full source.
fn fm6(body: &str) -> String {
    format!("---\ntitle: Validation\ndescription: |\n  first\n  second\n---\n{body}")
}

#[tokio::test]
async fn validation_flags_forbidden_markup_at_full_source_lines() {
    let srv = Server::start();
    let crlf =
        fm6("<p>a</p>\n<p>b</p>\n<link rel=\"stylesheet\" href=\"x.css\">\n").replace('\n', "\r\n");
    let cases: Vec<(&str, String, Vec<u64>)> = vec![
        (
            "style-element",
            fm6("<p>ok</p>\n\n<style>p{}</style>"),
            vec![9],
        ),
        (
            "style-attr",
            fm6("<p>a</p>\n<div style=\"color:red\">x</div>"),
            vec![8],
        ),
        ("style-attr-uppercase", fm6("<P STYLE=\"x\">y</P>"), vec![7]),
        (
            "link-first-body-line",
            fm6("<link rel=\"stylesheet\" href=\"x.css\">"),
            vec![7],
        ),
        (
            "script-src",
            fm6("\n\n\n<script src=\"x.js\"></script>"),
            vec![10],
        ),
        (
            "img-https",
            fm6("<p>\n<img src=\"https://x.test/a.png\">\n</p>"),
            vec![8],
        ),
        (
            "img-http-uppercase",
            fm6("<img src=\"HTTP://x.test/a.png\">"),
            vec![7],
        ),
        (
            "img-protocol-relative",
            fm6("<img src=\"//x.test/a.png\">"),
            vec![7],
        ),
        (
            "srcset-second-candidate",
            fm6("<img src=\"assets/a.png\" srcset=\"assets/a.png 1x, https://x.test/b.png 2x\">"),
            vec![7],
        ),
        (
            "video-poster",
            fm6("<video poster=\"https://x.test/p.png\"></video>"),
            vec![7],
        ),
        (
            "after-multiline-inline-script",
            fm6(
                "<script>\nconst a = 1;\nconst b = 2;\n</script>\n<img src=\"https://x.test/a.png\">",
            ),
            vec![11],
        ),
        (
            "after-multiline-pre",
            fm6("<pre><code>a\nb\nc</code></pre>\n<style></style>"),
            vec![10],
        ),
        (
            "multiple-sorted",
            fm6("<style></style>\n<p>x</p>\n<iframe></iframe>\n<embed>"),
            vec![7, 9, 10],
        ),
        ("doctype", fm6("<p>x</p>\n<!doctype html>"), vec![8]),
        ("meta", fm6("<meta charset=\"utf-8\">"), vec![7]),
        ("base", fm6("<base href=\"/\">"), vec![7]),
        ("object", fm6("<object></object>"), vec![7]),
        ("crlf-line-endings", crlf, vec![9]),
    ];
    for (slug, source, lines) in cases {
        let resp = srv.put_source("p", slug, &source).await;
        assert_eq!(resp.status, 422, "{slug}: {}", resp.text());
        let body = resp.json();
        assert_eq!(body["error"], "validation", "{slug}");
        let expected: Vec<Option<u64>> = lines.into_iter().map(Some).collect();
        assert_eq!(problem_lines(&body), expected, "{slug}: {body}");
        assert_eq!(
            srv.get(&format!("/api/reports/p/{slug}")).await.status,
            404,
            "{slug}: rejected source must not be stored"
        );
    }
}

#[tokio::test]
async fn validation_allows_safe_constructs() {
    let srv = Server::start();
    let cases = [
        (
            "json-payload",
            "<x-chart><script type=\"application/json\">{\"x\": \"<div style=\\\"color:red\\\"><img src=\\\"https://x.test/a.png\\\">\"}</script></x-chart>",
        ),
        (
            "text-plain-payload",
            "<x-diff><script type=\"text/plain\">\n-<style>a{}</style>\n+<link href=\"https://x.test\">\n</script></x-diff>",
        ),
        (
            "escaped-code",
            "<pre><code class=\"language-html\">&lt;div style=\"color:red\"&gt;&lt;/div&gt;\n&lt;script src=\"x.js\"&gt;</code></pre>",
        ),
        (
            "prose-mentioning-style",
            "<p>set style=\"color:red\" on the div</p>",
        ),
        (
            "inline-script",
            "<script>\ndocument.body.style.color = \"red\";\nconst s = '<img src=\"https://x.test/a.png\">';\n</script>",
        ),
        (
            "data-image",
            "<img src=\"data:image/png;base64,iVBORw0KGgo=\">",
        ),
        (
            "asset-image",
            "<figure><img src=\"assets/a.png\" srcset=\"assets/a.png 1x, assets/a@2x.png 2x\"><figcaption>c</figcaption></figure>",
        ),
        ("external-link", "<a href=\"https://example.com\">link</a>"),
        (
            "inline-svg",
            "<svg viewBox=\"0 0 1 1\"><rect width=\"1\" height=\"1\"/></svg>",
        ),
    ];
    for (slug, body) in cases {
        let source = doc("Allowed", body);
        let resp = srv.put_source("p", slug, &source).await;
        assert_eq!(resp.status, 200, "{slug}: {}", resp.text());
    }
}

#[tokio::test]
async fn frontmatter_rules() {
    let srv = Server::start();
    // (slug, source, expected line of the single problem; None = line not pinned)
    let rejected: Vec<(&str, String, Option<u64>)> = vec![
        ("no-frontmatter", "<p>x</p>".into(), Some(1)),
        ("unterminated", "---\ntitle: T\n<p>x</p>".into(), Some(1)),
        (
            "missing-title",
            "---\ndescription: d\n---\n<p>x</p>".into(),
            None,
        ),
        (
            "empty-title",
            "---\ntitle: \"\"\n---\n<p>x</p>".into(),
            Some(2),
        ),
        (
            "unknown-key",
            "---\ntitle: T\ndescription: d\nauthor: me\n---\n".into(),
            Some(4),
        ),
        (
            "title-201-chars",
            format!("---\ntitle: {}\n---\n", "t".repeat(201)),
            Some(2),
        ),
        ("not-a-mapping", "---\n- a\n- b\n---\n".into(), None),
    ];
    for (slug, source, line) in rejected {
        let resp = srv.put_source("p", slug, &source).await;
        assert_eq!(resp.status, 422, "{slug}: {}", resp.text());
        let body = resp.json();
        assert_eq!(body["error"], "validation", "{slug}");
        let lines = problem_lines(&body);
        assert_eq!(lines.len(), 1, "{slug}: {body}");
        if line.is_some() {
            assert_eq!(lines[0], line, "{slug}: {body}");
        }
    }

    let accepted = [
        (
            "title-200-chars",
            format!("---\ntitle: {}\n---\n", "t".repeat(200)),
        ),
        // The limit counts characters, not bytes.
        (
            "title-200-multibyte",
            format!("---\ntitle: {}\n---\n", "é".repeat(200)),
        ),
        ("empty-body", "---\ntitle: T\n---\n".into()),
    ];
    for (slug, source) in accepted {
        let resp = srv.put_source("p", slug, &source).await;
        assert_eq!(resp.status, 200, "{slug}: {}", resp.text());
    }
}

#[tokio::test]
async fn identity_rules() {
    let srv = Server::start();
    let slug_64 = format!("a{}", "b".repeat(63));
    let slug_65 = format!("a{}", "b".repeat(64));
    let rejected = [
        ("list", "s"),
        ("guide", "s"),
        ("Upper", "s"),
        ("p", "Upper"),
        ("p", "-leading-dash"),
        ("p", "_leading-underscore"),
        ("p", "has.dot"),
        ("p", slug_65.as_str()),
    ];
    for (project, slug) in rejected {
        let resp = srv.put_source(project, slug, &doc("T", "<p>x</p>")).await;
        assert_eq!(resp.status, 422, "{project}/{slug}: {}", resp.text());
        assert_eq!(resp.json()["error"], "validation", "{project}/{slug}");
    }
    for (project, slug) in [("p", slug_64.as_str()), ("0p", "a_b-9"), ("lists", "guide")] {
        let resp = srv.put_source(project, slug, &doc("T", "<p>x</p>")).await;
        assert_eq!(resp.status, 200, "{project}/{slug}: {}", resp.text());
    }
}

#[tokio::test]
async fn source_over_5_mib_is_413() {
    let srv = Server::start();
    let limit = 5 * 1024 * 1024;
    let pad = |total: usize| {
        let mut s = doc("Big", "<p>");
        s.push_str(&"x".repeat(total - s.len() - 4));
        s.push_str("</p>");
        assert_eq!(s.len(), total);
        s
    };
    let at_limit = srv.put_source("p", "at-limit", &pad(limit)).await;
    assert_eq!(at_limit.status, 200, "{}", at_limit.text());
    let over = srv.put_source("p", "over", &pad(limit + 1)).await;
    assert_eq!(over.status, 413);
    assert_eq!(srv.get("/api/reports/p/over").await.status, 404);
}

#[tokio::test]
async fn text_version_renders_components_as_fenced_blocks() {
    let srv = Server::start();
    let body = "<h2>Overview</h2>\n\
<pre class=\"mermaid\">\ngraph TD; A-->B\n</pre>\n\
<x-chart><script type=\"application/json\">{\"mark\":\"bar\"}</script></x-chart>\n\
<x-diff mode=\"line\"><script type=\"text/plain\">\n--- a/f\n+++ b/f\n-old\n+new\n</script></x-diff>\n\
<script>console.log(\"not in text\")</script>\n";
    srv.upsert("proj", "s", "Charts", body).await;

    let resp = srv.get("/api/reports/proj/s/text").await;
    assert_eq!(resp.status, 200);
    assert!(
        resp.header("content-type")
            .unwrap()
            .starts_with("text/markdown")
    );
    let text = resp.text();
    assert!(text.starts_with("# proj: Charts\n"), "{text}");
    for fence in [
        "```mermaid\ngraph TD; A-->B\n```",
        "```vega-lite\n{\"mark\":\"bar\"}\n```",
        "```diff\n--- a/f\n+++ b/f\n-old\n+new\n```",
    ] {
        assert!(text.contains(fence), "missing {fence:?} in:\n{text}");
    }
    assert!(!text.contains("not in text"), "{text}");
    assert!(!text.contains("<x-chart"), "{text}");

    // The text version tracks the latest rev.
    srv.upsert("proj", "s", "Charts", "<p>second</p>").await;
    let text = srv.get("/api/reports/proj/s/text").await.text();
    assert!(text.contains("rev 2"), "{text}");
    assert!(
        text.contains("second") && !text.contains("mermaid"),
        "{text}"
    );
}
