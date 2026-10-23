use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::Rng;
use subtle::ConstantTimeEq;
use time::OffsetDateTime;

use crate::db;

pub const VIEW_CAP_TTL_SECS: i64 = 12 * 3600;
pub const SHARE_TTL_SECS: i64 = 7 * 24 * 3600;

const CAP_PREFIX: &str = "v1.";

/// HMAC-based view capability signer. The key lives in the DB `meta` table.
pub struct Caps {
    key: [u8; 32],
}

impl Caps {
    pub fn new(key: [u8; 32]) -> Self {
        Self { key }
    }

    pub fn load_or_create(c: &rusqlite::Connection) -> anyhow::Result<Self> {
        if let Some(existing) = db::Db::get_meta(c, "signing_key")? {
            let raw = URL_SAFE_NO_PAD
                .decode(existing.as_bytes())
                .map_err(|e| anyhow::anyhow!("corrupt signing key in meta: {e}"))?;
            if raw.len() == 32 {
                let mut key = [0u8; 32];
                key.copy_from_slice(&raw);
                return Ok(Self::new(key));
            }
            anyhow::bail!("corrupt signing key in meta (bad length)");
        }
        let mut key = [0u8; 32];
        rand::rng().fill_bytes(&mut key);
        db::Db::set_meta(c, "signing_key", &URL_SAFE_NO_PAD.encode(key))?;
        tracing::info!("generated new view-cap signing key");
        Ok(Self::new(key))
    }

    fn sign(&self, payload: &[u8]) -> [u8; 16] {
        use hmac::{Hmac, KeyInit, Mac};
        let mut mac =
            Hmac::<sha2::Sha256>::new_from_slice(&self.key).expect("HMAC accepts any key length");
        mac.update(payload);
        let out = mac.finalize().into_bytes();
        let mut tag = [0u8; 16];
        tag.copy_from_slice(&out[..16]);
        tag
    }

    /// Issue a cap for `project/slug`, valid until `expires`.
    pub fn issue(&self, project: &str, slug: &str, expires: OffsetDateTime) -> String {
        let payload = format!("{}:{}:{}", expires.unix_timestamp(), project, slug);
        let payload_b64 = URL_SAFE_NO_PAD.encode(payload.as_bytes());
        let tag_b64 = URL_SAFE_NO_PAD.encode(self.sign(payload.as_bytes()));
        format!("{CAP_PREFIX}{payload_b64}.{tag_b64}")
    }

    /// Verify a cap; returns `(project, slug, expires)` when the signature is valid
    /// (expiry is *not* checked here).
    pub fn verify(&self, cap: &str) -> Option<(String, String, OffsetDateTime)> {
        let rest = cap.strip_prefix(CAP_PREFIX)?;
        let (payload_b64, tag_b64) = rest.split_once('.')?;
        if tag_b64.contains('.') {
            return None;
        }
        let payload = URL_SAFE_NO_PAD.decode(payload_b64.as_bytes()).ok()?;
        let tag = URL_SAFE_NO_PAD.decode(tag_b64.as_bytes()).ok()?;
        if tag.len() != 16 {
            return None;
        }
        let expected = self.sign(&payload);
        if expected.ct_eq(tag.as_slice()).unwrap_u8() != 1 {
            return None;
        }
        let payload = String::from_utf8(payload).ok()?;
        let mut parts = payload.splitn(3, ':');
        let exp: i64 = parts.next()?.parse().ok()?;
        let project = parts.next()?.to_string();
        let slug = parts.next()?.to_string();
        let expires = OffsetDateTime::from_unix_timestamp(exp).ok()?;
        Some((project, slug, expires))
    }
}

/// Caps always look like `v1.<b64>.<b64>`; share tokens are bare base64url and can
/// never contain a dot, so the two are trivially distinguishable.
pub fn is_view_cap(token: &str) -> bool {
    token.starts_with(CAP_PREFIX)
}

/// 32 random bytes, base64url (43 chars, path safe).
pub fn new_share_token() -> String {
    let mut raw = [0u8; 32];
    rand::rng().fill_bytes(&mut raw);
    URL_SAFE_NO_PAD.encode(raw)
}
