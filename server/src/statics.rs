use std::path::{Component, Path, PathBuf};

use axum::{
    body::Body,
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::Response,
};

/// `OPTIONS` response for the CORS-enabled public GET endpoints. Sandboxed
/// iframe module fetches are simple requests, but tooling that injects
/// `X-Agent-Reports-Owner` into a tab triggers a preflight; answer it.
pub fn cors_preflight(headers: &HeaderMap) -> Response {
    let mut resp = Response::new(Body::empty());
    *resp.status_mut() = StatusCode::NO_CONTENT;
    let h = resp.headers_mut();
    h.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    h.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, HEAD, OPTIONS"),
    );
    h.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        headers
            .get(header::ACCESS_CONTROL_REQUEST_HEADERS)
            .cloned()
            .unwrap_or_else(|| HeaderValue::from_static("*")),
    );
    h.insert(
        header::ACCESS_CONTROL_MAX_AGE,
        HeaderValue::from_static("86400"),
    );
    resp
}

/// Resolve a URL-relative path under `root`, rejecting traversal.
pub fn safe_join(root: &Path, rel: &str) -> Option<PathBuf> {
    let rel = rel.trim_start_matches('/');
    if rel.is_empty() || rel.contains('\0') || rel.contains('\\') {
        return None;
    }
    let mut out = root.to_path_buf();
    for part in rel.split('/') {
        if part.is_empty() || part == "." || part == ".." {
            return None;
        }
        if Path::new(part).components().count() != 1 {
            return None;
        }
    }
    // Rebuild from components to be explicit about what we accept.
    for part in rel.split('/') {
        if matches!(
            Path::new(part).components().next(),
            Some(Component::Normal(_))
        ) {
            out.push(part);
        } else {
            return None;
        }
    }
    Some(out)
}

pub fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("js") | Some("mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("html") => "text/html; charset=utf-8",
        Some("json") | Some("map") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("avif") => "image/avif",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("ttf") => "font/ttf",
        Some("wasm") => "application/wasm",
        Some("txt") => "text/plain; charset=utf-8",
        Some("csv") => "text/csv; charset=utf-8",
        Some("ico") => "image/x-icon",
        Some("webmanifest") => "application/manifest+json",
        _ => mime_guess::from_path(path)
            .first_raw()
            .unwrap_or("application/octet-stream"),
    }
}

pub fn html_error(status: StatusCode, message: &str) -> Response {
    let body = format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>{code} {reason}</title></head>\
<body style=\"font-family: system-ui, sans-serif; padding: 2rem; color: #1b1f24\"><h1>{code} {reason}</h1><p>{message}</p></body></html>",
        code = status.as_u16(),
        reason = status.canonical_reason().unwrap_or("Error"),
        message = crate::doc::escape(message),
    );
    let mut resp = Response::new(Body::from(body));
    *resp.status_mut() = status;
    resp.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    resp.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    resp
}

/// Read a file and build a response with cache + optional CORS/CSP headers.
pub async fn serve_file(
    path: &Path,
    cache_control: &str,
    cors: bool,
    svg_sandbox: bool,
    not_found_message: &str,
) -> Response {
    match tokio::fs::read(path).await {
        Ok(bytes) => {
            let mut resp = Response::new(Body::from(bytes));
            resp.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static(content_type(path)),
            );
            if let Ok(value) = HeaderValue::from_str(cache_control) {
                resp.headers_mut().insert(header::CACHE_CONTROL, value);
            }
            if cors {
                resp.headers_mut().insert(
                    header::ACCESS_CONTROL_ALLOW_ORIGIN,
                    HeaderValue::from_static("*"),
                );
            }
            if svg_sandbox {
                resp.headers_mut().insert(
                    header::CONTENT_SECURITY_POLICY,
                    HeaderValue::from_static("sandbox"),
                );
            }
            resp
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            let mut resp = html_error(StatusCode::NOT_FOUND, not_found_message);
            if cors {
                resp.headers_mut().insert(
                    header::ACCESS_CONTROL_ALLOW_ORIGIN,
                    HeaderValue::from_static("*"),
                );
            }
            resp
        }
        Err(err) => {
            tracing::warn!(path = %path.display(), error = %err, "failed to read static file");
            let mut resp = html_error(StatusCode::INTERNAL_SERVER_ERROR, "failed to read file");
            if cors {
                resp.headers_mut().insert(
                    header::ACCESS_CONTROL_ALLOW_ORIGIN,
                    HeaderValue::from_static("*"),
                );
            }
            resp
        }
    }
}
