use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};

/// A JSON error response, used by every `/api/*` endpoint (and the share JSON endpoints).
#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub body: Value,
}

impl ApiError {
    pub fn new(status: StatusCode, body: Value) -> Self {
        Self { status, body }
    }

    pub fn bad_request(msg: &str) -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            json!({ "error": "bad_request", "message": msg }),
        )
    }

    pub fn not_found() -> Self {
        Self::new(StatusCode::NOT_FOUND, json!({ "error": "not_found" }))
    }

    pub fn gone() -> Self {
        Self::new(StatusCode::GONE, json!({ "error": "gone" }))
    }

    pub fn payload_too_large() -> Self {
        Self::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            json!({ "error": "too_large" }),
        )
    }

    pub fn internal() -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": "internal" }),
        )
    }

    pub fn validation(problems: Value) -> Self {
        Self::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            json!({ "error": "validation", "problems": problems }),
        )
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(self.body)).into_response()
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(err: anyhow::Error) -> Self {
        tracing::error!(error = %err, "internal error");
        Self::internal()
    }
}
