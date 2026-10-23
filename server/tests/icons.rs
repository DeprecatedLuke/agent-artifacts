//! Glyph rule (unicode arrows/symbols/emoji must be `<x-icon>`) and `<x-icon>` name checks.

mod common;

use common::{Server, doc};
use serde_json::Value;

/// `(line, message)` of every problem in a 422 body, in response order.
fn problems(body: &Value) -> Vec<(Option<u64>, String)> {
    body["problems"]
        .as_array()
        .expect("problems array")
        .iter()
        .map(|p| {
            (
                p["line"].as_u64(),
                p["message"].as_str().expect("message").to_string(),
            )
        })
        .collect()
}

/// Spec message for a glyph with a suggestion-map entry.
fn suggests(glyph: &str, code: &str, icon: &str) -> String {
    format!(
        "\"{glyph}\" (U+{code}) — use <x-icon name=\"{icon}\"></x-icon> instead of unicode arrows, symbols or emoji (in math use \\to, \\Rightarrow)"
    )
}

/// Spec message for a banned glyph without a suggestion-map entry.
fn fallback(glyph: &str, code: &str) -> String {
    format!(
        "\"{glyph}\" (U+{code}) — use <x-icon name=\"…\"> with a Heroicons name (heroicons.com) instead of unicode arrows, symbols or emoji (in math use \\to, \\Rightarrow)"
    )
}

fn in_frontmatter(glyph: &str, code: &str, field: &str) -> String {
    format!(
        "\"{glyph}\" (U+{code}) in {field} — titles and descriptions are plain text; remove unicode arrows, symbols and emoji"
    )
}

const UNKNOWN_NOPE: &str = "unknown icon \"nope\" — use a Heroicons 20/solid name (heroicons.com), e.g. arrow-right, check, x-mark";

/// Asserts a 422 validation response with exactly `expected` problems and that nothing was stored.
async fn assert_rejected(srv: &Server, slug: &str, source: &str, expected: Vec<(u64, String)>) {
    let resp = srv.put_source("p", slug, source).await;
    assert_eq!(resp.status, 422, "{slug}: {}", resp.text());
    let body = resp.json();
    assert_eq!(body["error"], "validation", "{slug}");
    let expected: Vec<(Option<u64>, String)> =
        expected.into_iter().map(|(l, m)| (Some(l), m)).collect();
    assert_eq!(problems(&body), expected, "{slug}: {body}");
    assert_eq!(
        srv.get(&format!("/api/reports/p/{slug}")).await.status,
        404,
        "{slug}: rejected source must not be stored"
    );
}

/// `(slug, source or body, expected (line, message) problems)`.
type RejectCase = (&'static str, &'static str, Vec<(u64, String)>);

// `doc()` frontmatter is lines 1-3, so body line 1 is source line 4.

#[tokio::test]
async fn banned_glyphs_in_text_and_displayed_attributes_are_rejected_per_occurrence() {
    let srv = Server::start();
    let cases: Vec<RejectCase> = vec![
        (
            "arrow",
            "<p>next → step</p>",
            vec![(4, suggests("→", "2192", "arrow-right"))],
        ),
        (
            "dingbat-check-third-body-line",
            "<h2>Status</h2>\n<ul>\n<li>done ✓</li>\n</ul>",
            vec![(6, suggests("✓", "2713", "check"))],
        ),
        // VS16 belongs to the emoji before it: one problem naming the base glyph.
        (
            "emoji-with-vs16",
            "<p>shipped ✔\u{FE0F}</p>",
            vec![(4, suggests("✔", "2714", "check"))],
        ),
        (
            "lone-vs16",
            "<p>plain x\u{FE0F}</p>",
            vec![(4, fallback("\u{FE0F}", "FE0F"))],
        ),
        (
            "geometric-triangle",
            "<p>▲ 3%</p>",
            vec![(4, suggests("▲", "25B2", "chevron-up"))],
        ),
        (
            "misc-symbol-warning",
            "<p>⚠ careful</p>",
            vec![(4, suggests("⚠", "26A0", "exclamation-triangle"))],
        ),
        (
            "pictograph-emoji",
            "<p>🚀 launch</p>",
            vec![(4, suggests("🚀", "1F680", "rocket-launch"))],
        ),
        (
            "unmapped-glyph",
            "<p>love ♥</p>",
            vec![(4, fallback("♥", "2665"))],
        ),
        (
            "one-problem-per-occurrence",
            "<p>a → b → c ✓</p>\n<p>✓</p>",
            vec![
                (4, suggests("→", "2192", "arrow-right")),
                (4, suggests("→", "2192", "arrow-right")),
                (4, suggests("✓", "2713", "check")),
                (5, suggests("✓", "2713", "check")),
            ],
        ),
        (
            "multiline-text-node",
            "<p>first\nsecond\nthird ✗</p>",
            vec![(6, suggests("✗", "2717", "x-mark"))],
        ),
        (
            "alt-attr",
            "<p>x</p>\n<img src=\"assets/a.png\" alt=\"passed ✓\">",
            vec![(5, suggests("✓", "2713", "check"))],
        ),
        (
            "title-attr-multiline-value",
            "<abbr title=\"one\ntwo ⇒\">x</abbr>",
            vec![(5, suggests("⇒", "21D2", "arrow-long-right"))],
        ),
        (
            "label-attr",
            "<x-icon name=\"check\" label=\"Done ✓\"></x-icon>",
            vec![(4, suggests("✓", "2713", "check"))],
        ),
        // Exempt subtrees end at their closing tag (and nested exempt tags don't end the outer one).
        (
            "after-exempt-subtree-closes",
            "<pre><code>→</code> ←</pre>\n<p>→</p>",
            vec![(5, suggests("→", "2192", "arrow-right"))],
        ),
        (
            "after-comment",
            "<!-- → -->\n<p>←</p>",
            vec![(5, suggests("←", "2190", "arrow-left"))],
        ),
    ];
    for (slug, body, expected) in cases {
        assert_rejected(&srv, slug, &doc("T", body), expected).await;
    }
}

#[tokio::test]
async fn glyphs_in_exempt_contexts_and_allowed_characters_are_accepted() {
    let srv = Server::start();
    let cases = [
        ("pre", "<pre>a → b ✓\n⚠ ▲</pre>"),
        ("code", "<p>use <code>a → b</code> here</p>"),
        ("kbd", "<p>press <kbd>⇧ ↵</kbd></p>"),
        ("samp", "<p>prints <samp>✓ ok</samp></p>"),
        ("nested-exempt", "<pre><code>→</code> ✓</pre>"),
        (
            "script-json",
            "<x-chart><script type=\"application/json\">{\"title\": \"→ ✓ 🚀\"}</script></x-chart>",
        ),
        (
            "script-text-plain",
            "<script type=\"text/plain\">\n→ ✓\n</script>",
        ),
        ("script-inline", "<script>\nconst s = \"✓ →\";\n</script>"),
        (
            "x-diff",
            "<x-diff mode=\"line\"><script type=\"text/plain\">\n-a → b\n+a ✓ b\n</script></x-diff>",
        ),
        (
            "x-chart-content",
            "<x-chart>→<script type=\"application/json\">{}</script></x-chart>",
        ),
        (
            "svg",
            "<svg viewBox=\"0 0 1 1\" aria-label=\"→\"><text>✓ ▲</text></svg>",
        ),
        ("math", "<math><mi>a</mi><mo>→</mo><mi>b</mi></math>"),
        ("comment", "<!-- TODO → fix ✓ -->\n<p>x</p>"),
        ("href", "<a href=\"https://x.test/→/✓\">link</a>"),
        ("src", "<img src=\"assets/→.png\" alt=\"diagram\">"),
        ("data-attr", "<div data-label=\"✓\" data-dir=\"→\">x</div>"),
        (
            "allowed-punctuation-and-math",
            "<p>a − b × c — d – e · f • g ≤ h ≥ i ≈ j … € £ ¥ °C 日本語 Ünïcødé “q”</p>",
        ),
    ];
    for (slug, body) in cases {
        let resp = srv.put_source("p", slug, &doc("Allowed", body)).await;
        assert_eq!(resp.status, 200, "{slug}: {}", resp.text());
    }
}

#[tokio::test]
async fn frontmatter_title_and_description_must_be_glyph_free() {
    let srv = Server::start();
    let cases: Vec<RejectCase> = vec![
        (
            "title",
            "---\ntitle: Done ✓\n---\n<p>x</p>",
            vec![(2, in_frontmatter("✓", "2713", "title"))],
        ),
        (
            "inline-description",
            "---\ntitle: T\ndescription: careful ⚠\n---\n<p>x</p>",
            vec![(3, in_frontmatter("⚠", "26A0", "description"))],
        ),
        (
            "block-description-second-line",
            "---\ntitle: T\ndescription: |\n  first\n  then → next\n---\n<p>x</p>",
            vec![(5, in_frontmatter("→", "2192", "description"))],
        ),
        // The glyph only exists after YAML unescaping: reported on the key's line.
        (
            "escaped-title",
            "---\ntitle: \"a \\u2192 b\"\n---\n<p>x</p>",
            vec![(2, in_frontmatter("→", "2192", "title"))],
        ),
        (
            "frontmatter-and-body",
            "---\ntitle: 🚀 ✓\n---\n<p>→</p>",
            vec![
                (2, in_frontmatter("🚀", "1F680", "title")),
                (2, in_frontmatter("✓", "2713", "title")),
                (4, suggests("→", "2192", "arrow-right")),
            ],
        ),
    ];
    for (slug, source, expected) in cases {
        assert_rejected(&srv, slug, source, expected).await;
    }

    let allowed = "---\ntitle: Ünïcødé — a · b ≤ c…\ndescription: |\n  x − y × z\n---\n<p>x</p>";
    let resp = srv.put_source("p", "allowed", allowed).await;
    assert_eq!(resp.status, 200, "{}", resp.text());
    assert_eq!(
        srv.get("/api/reports/p/allowed").await.json()["title"],
        "Ünïcødé — a · b ≤ c…"
    );
}

#[tokio::test]
async fn x_icon_names_are_checked_against_icons_json() {
    let srv = Server::start_with_icons(&["check", "arrow-right", "x-mark"]);

    let ok = doc(
        "Icons",
        "<p><x-icon name=\"check\"></x-icon> ok, <x-icon name=\"arrow-right\" tone=\"ok\" label=\"Next\"></x-icon></p>",
    );
    let resp = srv.put_source("p", "known", &ok).await;
    assert_eq!(resp.status, 200, "{}", resp.text());

    assert_rejected(
        &srv,
        "unknown",
        &doc("Icons", "<p>a</p>\n<x-icon name=\"nope\"></x-icon>"),
        vec![(5, UNKNOWN_NOPE.to_string())],
    )
    .await;

    // Names come from icons.json, not from the built-in glyph table.
    let resp = srv
        .put_source(
            "p",
            "not-in-json",
            &doc("Icons", "<x-icon name=\"star\"></x-icon>"),
        )
        .await;
    assert_eq!(resp.status, 422, "{}", resp.text());
    assert_eq!(problems(&resp.json())[0].0, Some(4));

    let resp = srv
        .put_source(
            "p",
            "missing-name",
            &doc("Icons", "<p>a</p>\n<x-icon></x-icon>"),
        )
        .await;
    assert_eq!(resp.status, 422, "{}", resp.text());
    let found = problems(&resp.json());
    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(found[0].0, Some(5), "{found:?}");
    assert!(found[0].1.starts_with("unknown icon"), "{found:?}");
    assert_eq!(srv.get("/api/reports/p/missing-name").await.status, 404);
}

#[tokio::test]
async fn x_icon_names_are_not_checked_without_icons_json() {
    let srv = Server::start();
    let resp = srv
        .put_source("p", "s", &doc("Icons", "<x-icon name=\"nope\"></x-icon>"))
        .await;
    assert_eq!(resp.status, 200, "{}", resp.text());
}

#[tokio::test]
async fn text_version_renders_x_icon_as_its_first_glyph_or_placeholder() {
    let srv = Server::start();
    let body = "<p>Build <x-icon name=\"check\"></x-icon> passed</p>\n\
<p><x-icon name=\"x-mark\"></x-icon> lint, <x-icon name=\"arrow-right\"></x-icon> next, \
<x-icon name=\"sparkles\"></x-icon> party, <x-icon name=\"user-circle\"></x-icon> me</p>\n";
    srv.upsert("p", "s", "Icons", body).await;

    let text = srv.get("/api/reports/p/s/text").await.text();
    for expected in [
        "Build ✓ passed",
        "✗ lint, → next, 🎉 party, [icon:user-circle] me",
    ] {
        assert!(text.contains(expected), "missing {expected:?} in:\n{text}");
    }
    assert!(!text.contains("x-icon"), "{text}");
}

#[tokio::test]
async fn rejected_put_leaves_the_stored_report_unchanged() {
    let srv = Server::start_with_icons(&["check"]);
    let original = doc("Original", "<p>v1 <x-icon name=\"check\"></x-icon></p>");
    let first = srv.put_source("p", "s", &original).await;
    assert_eq!(first.status, 200, "{}", first.text());

    let rejected = [
        doc("Original", "<p>v2 ✓</p>"),
        doc("Changed ✓", "<p>v2</p>"),
        doc("Original", "<p>v2 <x-icon name=\"nope\"></x-icon></p>"),
    ];
    for source in rejected {
        let resp = srv.put_source("p", "s", &source).await;
        assert_eq!(resp.status, 422, "{source:?}: {}", resp.text());
    }

    let source = srv.get("/api/reports/p/s/source").await;
    assert_eq!(source.text(), original);
    assert_eq!(source.header("x-artifacts-rev"), Some("1"));
    let meta = srv.get("/api/reports/p/s").await.json();
    assert_eq!(meta["rev"], 1);
    assert_eq!(meta["title"], "Original");
    let text = srv.get("/api/reports/p/s/text").await.text();
    assert!(text.contains("v1 ✓") && !text.contains("v2"), "{text}");
}
