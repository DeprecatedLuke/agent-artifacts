use std::rc::Rc;

use htmd::{Element, HtmlToMarkdown, Node, element_handler::Handlers};
use markup5ever_rcdom::NodeData;

/// Build the HTML→Markdown converter with the report-specific component handlers.
pub fn converter() -> HtmlToMarkdown {
    HtmlToMarkdown::builder()
        .add_handler(vec!["pre"], |handlers: &dyn Handlers, element: Element| {
            let classes = attr(&element, "class").unwrap_or_default();
            if classes.split_whitespace().any(|c| c == "mermaid") {
                let code = raw_text(element.node);
                Some(format!("\n\n```mermaid\n{}\n```\n\n", code.trim_matches('\n')).into())
            } else {
                handlers.fallback(element)
            }
        })
        .add_handler(
            vec!["x-chart"],
            |_handlers: &dyn Handlers, element: Element| {
                let json = child_script(element.node, "application/json").unwrap_or_default();
                let json = json.trim();
                if json.is_empty() {
                    Some(String::new().into())
                } else {
                    Some(format!("\n\n```vega-lite\n{json}\n```\n\n").into())
                }
            },
        )
        .add_handler(
            vec!["x-diff"],
            |_handlers: &dyn Handlers, element: Element| {
                let diff = child_script(element.node, "text/plain").unwrap_or_default();
                let diff = diff.trim_matches('\n');
                if diff.is_empty() {
                    Some(String::new().into())
                } else {
                    Some(format!("\n\n```diff\n{diff}\n```\n\n").into())
                }
            },
        )
        .add_handler(
            vec!["x-compare"],
            |_handlers: &dyn Handlers, element: Element| {
                let mut srcs = Vec::new();
                collect_imgs(element.node, &mut srcs);
                let before = srcs.first().cloned().unwrap_or_default();
                let after = srcs.get(1).cloned().unwrap_or_default();
                Some(
                    format!("\n\nBefore/after: ![before]({before}) → ![after]({after})\n\n").into(),
                )
            },
        )
        .add_handler(
            vec!["x-icon"],
            |_handlers: &dyn Handlers, element: Element| {
                let name = attr(&element, "name").unwrap_or_default();
                Some(crate::icons::icon_text(&name).into())
            },
        )
        .add_handler(
            vec!["x-metric"],
            |_handlers: &dyn Handlers, element: Element| {
                let label = attr(&element, "label").unwrap_or_default();
                let value = attr(&element, "value").unwrap_or_default();
                let delta = attr(&element, "delta");
                let text = match delta.filter(|d| !d.trim().is_empty()) {
                    Some(d) => format!("**{label}**: {value} ({d})"),
                    None => format!("**{label}**: {value}"),
                };
                Some(format!("\n\n{text}\n\n").into())
            },
        )
        .add_handler(
            vec!["x-tabs"],
            |handlers: &dyn Handlers, element: Element| {
                let content = handlers.walk_children(element.node).content;
                Some(format!("\n\n{}\n\n", content.trim_matches('\n')).into())
            },
        )
        .add_handler(
            vec!["x-grid"],
            |handlers: &dyn Handlers, element: Element| {
                let content = handlers.walk_children(element.node).content;
                Some(format!("\n\n{}\n\n", content.trim_matches('\n')).into())
            },
        )
        .add_handler(
            vec!["section"],
            |handlers: &dyn Handlers, element: Element| {
                if parent_tag(element.node).as_deref() == Some("x-tabs") {
                    let title = attr(&element, "title").unwrap_or_default();
                    let content = handlers.walk_children(element.node).content;
                    Some(format!("\n\n### {title}\n\n{}\n\n", content.trim_matches('\n')).into())
                } else {
                    // Not a tab panel: behave like the default block element.
                    let content = handlers.walk_children(element.node).content;
                    Some(format!("\n\n{}\n\n", content.trim_matches('\n')).into())
                }
            },
        )
        .add_handler(vec!["script", "style"], |_: &dyn Handlers, _: Element| {
            Some(String::new().into())
        })
        .build()
}

/// Compose the agent-facing text version around an already-converted body.
pub fn compose(
    project: &str,
    title: &str,
    description: &str,
    updated_at: &str,
    rev: i64,
    markdown: &str,
) -> String {
    let md = normalize_blank_lines(markdown.trim_matches('\n'));
    let mut out =
        format!("# {project}: {title}\n\n{description}\n\nUpdated {updated_at} · rev {rev}\n\n");
    out.push_str(&md);
    out.push('\n');
    out
}

/// Collapse whitespace-only lines and runs of blank lines produced by block handlers.
fn normalize_blank_lines(md: &str) -> String {
    let mut out = String::with_capacity(md.len());
    let mut pending_blank = false;
    for line in md.lines() {
        if line.trim().is_empty() {
            pending_blank = true;
            continue;
        }
        if !out.is_empty() {
            out.push('\n');
            if pending_blank {
                out.push('\n');
            }
        }
        out.push_str(line.trim_end());
        pending_blank = false;
    }
    out
}

fn attr(element: &Element, name: &str) -> Option<String> {
    element
        .attrs
        .iter()
        .find(|a| &*a.name.local == name)
        .map(|a| a.value.to_string())
}

fn node_tag(node: &Rc<Node>) -> Option<String> {
    match &node.data {
        NodeData::Element { name, .. } => Some(name.local.to_string()),
        _ => None,
    }
}

fn parent_tag(node: &Rc<Node>) -> Option<String> {
    let guard = node.parent.take();
    let parent = guard.as_ref().and_then(|p| p.upgrade());
    node.parent.set(guard);
    parent.and_then(|p| node_tag(&p))
}

fn raw_text(node: &Rc<Node>) -> String {
    let mut out = String::new();
    collect_text(node, &mut out);
    out
}

fn collect_text(node: &Rc<Node>, out: &mut String) {
    match &node.data {
        NodeData::Text { contents } => out.push_str(&contents.borrow()),
        NodeData::Element { .. } | NodeData::Document => {
            for child in node.children.borrow().iter() {
                collect_text(child, out);
            }
        }
        _ => {}
    }
}

fn child_script(node: &Rc<Node>, want_type: &str) -> Option<String> {
    let children = node.children.borrow();
    for child in children.iter() {
        if let NodeData::Element { name, attrs, .. } = &child.data
            && &*name.local == "script"
        {
            let ty = attrs
                .borrow()
                .iter()
                .find(|a| &*a.name.local == "type")
                .map(|a| a.value.to_string())
                .unwrap_or_default();
            if ty.eq_ignore_ascii_case(want_type) {
                return Some(raw_text(child));
            }
        }
    }
    // Fall back to any script child.
    for child in children.iter() {
        if let NodeData::Element { name, .. } = &child.data
            && &*name.local == "script"
        {
            return Some(raw_text(child));
        }
    }
    None
}

fn collect_imgs(node: &Rc<Node>, out: &mut Vec<String>) {
    if let NodeData::Element { name, attrs, .. } = &node.data
        && &*name.local == "img"
    {
        if let Some(src) = attrs
            .borrow()
            .iter()
            .find(|a| &*a.name.local == "src")
            .map(|a| a.value.to_string())
        {
            out.push(src);
        }
        return;
    }
    if matches!(node.data, NodeData::Document | NodeData::Element { .. }) {
        for child in node.children.borrow().iter() {
            collect_imgs(child, out);
        }
    }
}
