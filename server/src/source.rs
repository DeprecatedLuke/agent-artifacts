use html5gum::{DefaultEmitter, Token, Tokenizer};
use serde::Serialize;
use serde_yaml_ng::Value as Yaml;

use crate::icons;

/// A validation problem, with a 1-based line number in the *full* source.
#[derive(Debug, Clone, Serialize)]
pub struct Problem {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
    pub message: String,
}

impl Problem {
    fn at(line: Option<usize>, message: impl Into<String>) -> Self {
        Self {
            line,
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Parsed {
    pub title: String,
    /// Multi-line description, lines separated by `\n` (already trimmed).
    pub description: String,
    /// Everything after the closing `---` line, byte-for-byte.
    pub body: String,
}

/// Extract the body (everything after the closing `---` line) from a stored source.
/// Returns `""` when the source has no frontmatter; stored sources have been validated.
pub fn body_of(source: &str) -> &str {
    let mut offset = 0usize;
    let mut seen_first = false;
    for line in source.split_inclusive('\n') {
        let trimmed = line.trim_end_matches('\n').trim_end_matches('\r').trim();
        if !seen_first {
            seen_first = true;
            if trimmed != "---" {
                return source;
            }
        } else if trimmed == "---" {
            return &source[offset + line.len()..];
        }
        offset += line.len();
    }
    ""
}

/// Problem line for the first frontmatter key occurrence (1-based, full source).
fn key_line(lines: &[&str], key: &str, fm_end: usize) -> Option<usize> {
    for (i, line) in lines[1..fm_end].iter().enumerate() {
        let trimmed = line.trim_start();
        let candidate = trimmed.trim_start_matches(['"', '\'']);
        if candidate
            .strip_prefix(key)
            .is_some_and(|rest| rest.trim_start().starts_with(':'))
        {
            return Some(i + 2);
        }
    }
    None
}

/// Banned glyphs in the parsed `title`/`description` value, one problem per occurrence. Each is
/// placed on the raw frontmatter line holding it (matched in order within the key's block);
/// glyphs that only exist after YAML unescaping fall back to the key's line.
fn frontmatter_glyph_problems(
    lines: &[&str],
    fm_end: usize,
    key: &str,
    value: &str,
) -> Vec<Problem> {
    let Some(start) = key_line(lines, key, fm_end) else {
        return Vec::new();
    };
    // `start` is 1-based; the key's block runs until the next non-indented, non-blank line.
    let block_end = (start..fm_end)
        .find(|&i| {
            let line = lines[i].trim_end_matches('\r');
            !line.trim().is_empty() && !line.starts_with([' ', '\t'])
        })
        .unwrap_or(fm_end);
    let mut raw: Vec<(char, usize)> = (start - 1..block_end)
        .flat_map(|i| icons::banned_glyphs(lines[i]).map(move |(_, c)| (c, i + 1)))
        .collect();
    icons::banned_glyphs(value)
        .map(|(_, c)| {
            let line = match raw.iter().position(|(rc, _)| *rc == c) {
                Some(pos) => raw.remove(pos).1,
                None => start,
            };
            Problem::at(Some(line), icons::frontmatter_glyph_message(c, key))
        })
        .collect()
}

fn line_at(body: &str, base_line: usize, byte_offset: usize) -> usize {
    let offset = byte_offset.min(body.len());
    base_line + body[..offset].bytes().filter(|b| *b == b'\n').count()
}

/// Parse frontmatter + validate the fragment. Returns every problem found, sorted by line.
pub fn parse_and_validate(
    source: &str,
    icon_names: &icons::IconNames,
) -> Result<Parsed, Vec<Problem>> {
    let lines: Vec<&str> = source.split('\n').collect();
    let first = lines
        .first()
        .copied()
        .unwrap_or("")
        .trim_end_matches('\r')
        .trim();
    if first != "---" {
        return Err(vec![Problem::at(
            Some(1),
            "missing YAML frontmatter: the source must start with a `---` line",
        )]);
    }

    let fm_end = match (1..lines.len()).find(|&i| lines[i].trim_end_matches('\r').trim() == "---") {
        Some(i) => i,
        None => {
            return Err(vec![Problem::at(
                Some(1),
                "unterminated YAML frontmatter: no closing `---` line",
            )]);
        }
    };

    let fm_text = lines[1..fm_end].join("\n");
    let mut problems = Vec::new();

    let title;
    let description;

    let parsed_frontmatter = if fm_text.trim().is_empty() {
        Ok(Yaml::Mapping(serde_yaml_ng::Mapping::new()))
    } else {
        serde_yaml_ng::from_str::<Yaml>(&fm_text)
    };

    match parsed_frontmatter {
        Ok(Yaml::Mapping(map)) => {
            for (k, _) in map.iter() {
                let Some(key) = k.as_str() else {
                    problems.push(Problem::at(
                        Some(2),
                        "frontmatter keys must be plain strings",
                    ));
                    continue;
                };
                if key != "title" && key != "description" {
                    problems.push(Problem::at(
                        key_line(&lines, key, fm_end),
                        format!("unknown frontmatter key `{key}` (only `title` and `description` are allowed)"),
                    ));
                }
            }

            let t = map.get("title");
            match t {
                None | Some(Yaml::Null) => problems.push(Problem::at(
                    key_line(&lines, "title", fm_end).or(Some(2)),
                    "missing required frontmatter key `title`",
                )),
                Some(Yaml::String(s)) => {
                    let s = s.trim_end_matches(['\r', '\n']);
                    if s.trim().is_empty() {
                        problems.push(Problem::at(
                            key_line(&lines, "title", fm_end),
                            "`title` must not be empty",
                        ));
                    } else if s.contains('\n') {
                        problems.push(Problem::at(
                            key_line(&lines, "title", fm_end),
                            "`title` must be a single line",
                        ));
                    } else if s.chars().count() > 200 {
                        problems.push(Problem::at(
                            key_line(&lines, "title", fm_end),
                            "`title` must be at most 200 characters",
                        ));
                    }
                }
                Some(_) => problems.push(Problem::at(
                    key_line(&lines, "title", fm_end),
                    "`title` must be a string",
                )),
            }

            match map.get("description") {
                None | Some(Yaml::Null) => description = String::new(),
                Some(Yaml::String(s)) => {
                    description = s.trim_end_matches(['\r', '\n']).to_string();
                }
                Some(_) => {
                    problems.push(Problem::at(
                        key_line(&lines, "description", fm_end),
                        "`description` must be a string",
                    ));
                    description = String::new();
                }
            }

            title = map
                .get("title")
                .and_then(|v| v.as_str())
                .map(|s| s.trim_end_matches(['\r', '\n']).trim().to_string())
                .unwrap_or_default();

            for (key, value) in [
                ("title", title.as_str()),
                ("description", description.as_str()),
            ] {
                problems.extend(frontmatter_glyph_problems(&lines, fm_end, key, value));
            }
        }
        Ok(_) => {
            problems.push(Problem::at(
                Some(2),
                "frontmatter must be a YAML mapping with `title` (and optional `description`)",
            ));
            title = String::new();
            description = String::new();
        }
        Err(err) => {
            problems.push(Problem::at(
                Some(2),
                format!("invalid YAML frontmatter: {err}"),
            ));
            title = String::new();
            description = String::new();
        }
    }

    let body = lines[fm_end + 1..].join("\n");
    let body_line = fm_end + 2;
    problems.extend(validate_body(&body, body_line, icon_names));

    if problems.is_empty() {
        Ok(Parsed {
            title,
            description,
            body,
        })
    } else {
        problems.sort_by_key(|p| p.line.unwrap_or(usize::MAX));
        Err(problems)
    }
}

const FORBIDDEN_ELEMENTS: &[&str] = &[
    "style", "link", "html", "head", "body", "meta", "base", "iframe", "object", "embed",
];

fn is_external_url(value: &str) -> bool {
    let v = value.trim_start();
    let lower = v.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("//")
}

fn check_url_attr(name: &str, value: &str) -> Option<String> {
    match name {
        "src" | "poster" => is_external_url(value).then(|| {
            format!("`{name}` must point to `assets/...` or a `data:` URL, not an external URL")
        }),
        "srcset" => {
            let bad = value.split(',').any(|candidate| {
                candidate
                    .split_whitespace()
                    .next()
                    .is_some_and(is_external_url)
            });
            bad.then(|| {
                "`srcset` must point to `assets/...` or `data:` URLs, not external URLs".to_string()
            })
        }
        _ => None,
    }
}

/// Subtrees whose content and attributes never need `<x-icon>` (code, data payloads, math, SVG).
const EXEMPT_ELEMENTS: &[&str] = &[
    "pre", "code", "kbd", "samp", "script", "x-diff", "x-chart", "svg", "math",
];

/// Attribute values that may contain banned code points (URLs and machine data, not prose).
const GLYPH_FREE_ATTRS: &[&str] = &["href", "src", "srcset", "poster"];

/// Report every banned glyph in `text`, numbering lines from `first_line`.
fn push_glyph_problems(text: &str, first_line: usize, problems: &mut Vec<Problem>) {
    let mut line = first_line;
    let mut last = 0usize;
    for (idx, c) in icons::banned_glyphs(text) {
        line += text[last..idx].bytes().filter(|b| *b == b'\n').count();
        last = idx;
        problems.push(Problem::at(Some(line), icons::glyph_message(c)));
    }
}

fn validate_body(body: &str, base_line: usize, icon_names: &icons::IconNames) -> Vec<Problem> {
    let mut problems = Vec::new();
    // Currently open exempt subtrees, innermost last.
    let mut exempt: Vec<String> = Vec::new();

    let mut emitter = DefaultEmitter::<usize>::new_with_span();
    emitter.naively_switch_states(true);
    let tokenizer = Tokenizer::new_with_emitter(body, emitter);

    for token in tokenizer.flatten() {
        match token {
            Token::Doctype(spanned) => {
                problems.push(Problem::at(
                    Some(line_at(body, base_line, spanned.span.start)),
                    "<!doctype> is not allowed inside a report body",
                ));
            }
            Token::StartTag(tag) => {
                let line = Some(line_at(body, base_line, tag.span.start));
                let name = String::from_utf8_lossy(&tag.name).to_ascii_lowercase();
                if FORBIDDEN_ELEMENTS.contains(&name.as_str()) {
                    problems.push(Problem::at(
                        line,
                        format!("<{name}> is not allowed inside a report body"),
                    ));
                }
                if name == "script"
                    && tag
                        .attributes
                        .keys()
                        .any(|k| k.eq_ignore_ascii_case(b"src"))
                {
                    problems.push(Problem::at(line, "<script src=...> is not allowed"));
                }
                let is_exempt = EXEMPT_ELEMENTS.contains(&name.as_str());
                let glyphs_checked = exempt.is_empty() && !is_exempt;
                for (attr, value) in &tag.attributes {
                    let aname = String::from_utf8_lossy(attr).to_ascii_lowercase();
                    let aval = String::from_utf8_lossy(value.value.as_slice());
                    if aname == "style" {
                        problems.push(Problem::at(
                            line,
                            "inline `style=` attributes are not allowed",
                        ));
                    }
                    if let Some(msg) = check_url_attr(&aname, &aval) {
                        problems.push(Problem::at(line, msg));
                    }
                    if glyphs_checked
                        && !GLYPH_FREE_ATTRS.contains(&aname.as_str())
                        && !aname.starts_with("data-")
                    {
                        let first_line = line_at(body, base_line, value.span.start);
                        push_glyph_problems(&aval, first_line, &mut problems);
                    }
                }
                if glyphs_checked && name == "x-icon" {
                    let icon_name = tag
                        .attributes
                        .iter()
                        .find(|(attr, _)| attr.eq_ignore_ascii_case(b"name"))
                        .map(|(_, value)| {
                            String::from_utf8_lossy(value.value.as_slice()).to_string()
                        });
                    match icon_name {
                        Some(n) if icon_names.accepts(&n) => {}
                        Some(n) => {
                            problems.push(Problem::at(line, icons::unknown_icon_message(&n)))
                        }
                        None => problems.push(Problem::at(line, icons::unknown_icon_message(""))),
                    }
                }
                if !tag.self_closing && is_exempt {
                    exempt.push(name);
                }
            }
            Token::EndTag(tag) => {
                let name = String::from_utf8_lossy(&tag.name).to_ascii_lowercase();
                if let Some(pos) = exempt.iter().rposition(|open| *open == name) {
                    exempt.truncate(pos);
                }
            }
            Token::String(spanned) => {
                if exempt.is_empty() {
                    let text = String::from_utf8_lossy(spanned.value.as_slice());
                    let first_line = line_at(body, base_line, spanned.span.start);
                    push_glyph_problems(&text, first_line, &mut problems);
                }
            }
            Token::Comment(_) | Token::Error(_) => {}
        }
    }

    problems
}
