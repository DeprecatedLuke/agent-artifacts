//! Heroicons support: the `icons.json` name set and the glyph ↔ icon table that drives both
//! the glyph validation rule and the `x-icon` reverse mapping in the text version.

use std::{collections::HashSet, path::Path};

/// Glyph → Heroicons (20/solid) name. Order matters: the first glyph listed for a name is the
/// one the text version prints for `<x-icon name="…">`.
const GLYPH_ICONS: &[(char, &str)] = &[
    ('→', "arrow-right"),
    ('⟶', "arrow-right"),
    ('➜', "arrow-right"),
    ('➔', "arrow-right"),
    ('➡', "arrow-right"),
    ('←', "arrow-left"),
    ('⟵', "arrow-left"),
    ('⬅', "arrow-left"),
    ('↑', "arrow-up"),
    ('⬆', "arrow-up"),
    ('↓', "arrow-down"),
    ('⬇', "arrow-down"),
    ('↔', "arrows-right-left"),
    ('⇄', "arrows-right-left"),
    ('↕', "arrows-up-down"),
    ('⇒', "arrow-long-right"),
    ('⟹', "arrow-long-right"),
    ('⇐', "arrow-long-left"),
    ('↗', "arrow-up-right"),
    ('↘', "arrow-down-right"),
    ('↩', "arrow-uturn-left"),
    ('↪', "arrow-uturn-right"),
    ('⟳', "arrow-path"),
    ('↻', "arrow-path"),
    ('✓', "check"),
    ('✔', "check"),
    ('☑', "check"),
    ('✅', "check"),
    ('✗', "x-mark"),
    ('✘', "x-mark"),
    ('✕', "x-mark"),
    ('✖', "x-mark"),
    ('❌', "x-mark"),
    ('☒', "x-mark"),
    ('⚠', "exclamation-triangle"),
    ('❗', "exclamation-circle"),
    ('❓', "question-mark-circle"),
    ('ℹ', "information-circle"),
    ('★', "star"),
    ('☆', "star"),
    ('⭐', "star"),
    ('▲', "chevron-up"),
    ('▴', "chevron-up"),
    ('▼', "chevron-down"),
    ('▾', "chevron-down"),
    ('►', "chevron-right"),
    ('▶', "chevron-right"),
    ('▸', "chevron-right"),
    ('◄', "chevron-left"),
    ('◀', "chevron-left"),
    ('◂', "chevron-left"),
    ('⚡', "bolt"),
    ('⏱', "clock"),
    ('⏳', "clock"),
    ('⌛', "clock"),
    ('🔒', "lock-closed"),
    ('🔓', "lock-open"),
    ('💡', "light-bulb"),
    ('🚀', "rocket-launch"),
    ('🔥', "fire"),
    ('🐛', "bug-ant"),
    ('📈', "arrow-trending-up"),
    ('📉', "arrow-trending-down"),
    ('📌', "map-pin"),
    ('🔗', "link"),
    ('⛔', "no-symbol"),
    ('🚫', "no-symbol"),
    ('🎉', "sparkles"),
    ('✨', "sparkles"),
];

/// Variation selector-16 (emoji presentation); reported on its own, folded into a preceding glyph.
const VS16: char = '\u{FE0F}';

/// Code points that must be written as `<x-icon>` instead of unicode glyphs.
pub fn is_banned_glyph(c: char) -> bool {
    matches!(
        c as u32,
        0x2190..=0x21FF
            | 0x27F0..=0x27FF
            | 0x2900..=0x297F
            | 0x1F800..=0x1F8FF
            | 0x2B00..=0x2BFF
            | 0x25A0..=0x25FF
            | 0x2600..=0x26FF
            | 0x2700..=0x27BF
            | 0x1F000..=0x1FAFF
            | 0x231A..=0x231B
            | 0x23E9..=0x23F3
            | 0x23F8..=0x23FA
            | 0x2139
            | 0xFE0F
    )
}

/// Every banned glyph in `text`, as (byte offset, glyph). A VS16 directly following a banned
/// glyph belongs to that glyph and is not reported separately.
pub fn banned_glyphs(text: &str) -> impl Iterator<Item = (usize, char)> + '_ {
    let mut prev_banned = false;
    text.char_indices().filter(move |&(_, c)| {
        let banned = is_banned_glyph(c);
        let report = banned && !(c == VS16 && prev_banned);
        prev_banned = banned;
        report
    })
}

/// The validation message for one banned glyph occurrence (the line goes in `Problem::line`).
pub fn glyph_message(c: char) -> String {
    let fix = match GLYPH_ICONS.iter().find(|(g, _)| *g == c) {
        Some((_, name)) => format!("use <x-icon name=\"{name}\"></x-icon>"),
        None => "use <x-icon name=\"…\"> with a Heroicons name (heroicons.com)".to_string(),
    };
    format!(
        "\"{c}\" (U+{:04X}) — {fix} instead of unicode arrows, symbols or emoji (in math use \\to, \\Rightarrow)",
        c as u32
    )
}

/// The validation message for a banned glyph in the frontmatter `title` or `description`.
pub fn frontmatter_glyph_message(c: char, field: &str) -> String {
    format!(
        "\"{c}\" (U+{:04X}) in {field} — titles and descriptions are plain text; remove unicode arrows, symbols and emoji",
        c as u32
    )
}

/// The validation message for an `<x-icon>` without a known name.
pub fn unknown_icon_message(name: &str) -> String {
    format!(
        "unknown icon \"{name}\" — use a Heroicons 20/solid name (heroicons.com), e.g. arrow-right, check, x-mark"
    )
}

/// Text-version rendering of `<x-icon name="…">`: the table glyph, else `[icon:<name>]`.
pub fn icon_text(name: &str) -> String {
    match GLYPH_ICONS.iter().find(|(_, n)| *n == name) {
        Some((g, _)) => g.to_string(),
        None => format!("[icon:{name}]"),
    }
}

/// Heroicons names from `icons.json`; `None` when the file is unavailable (name checks skipped).
pub struct IconNames(Option<HashSet<String>>);

impl IconNames {
    /// Read `<render_dir>/icons.json`; logs one warning and disables name checks when missing.
    pub fn load(render_dir: &Path) -> Self {
        let path = render_dir.join("icons.json");
        let parsed = std::fs::read(&path)
            .map_err(|e| e.to_string())
            .and_then(|bytes| {
                serde_json::from_slice::<serde_json::Value>(&bytes).map_err(|e| e.to_string())
            })
            .and_then(|json| {
                json.get("icons")
                    .and_then(|icons| icons.as_object())
                    .map(|icons| icons.keys().cloned().collect::<HashSet<_>>())
                    .ok_or_else(|| "no `icons` object".to_string())
            });
        match parsed {
            Ok(names) => {
                tracing::info!(count = names.len(), "loaded icon names");
                Self(Some(names))
            }
            Err(err) => {
                tracing::warn!(
                    path = %path.display(),
                    error = %err,
                    "icons.json unavailable; <x-icon> names are not validated"
                );
                Self(None)
            }
        }
    }

    /// Whether `name` is acceptable; every non-empty name passes when icons.json is unavailable.
    pub fn accepts(&self, name: &str) -> bool {
        !name.is_empty() && self.0.as_ref().is_none_or(|names| names.contains(name))
    }
}
