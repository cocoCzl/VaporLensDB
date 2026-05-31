use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};

use crate::models::error::AppError;

const KEY_FILE: &str = "dev-secret.key";
const KEYCHAIN_SERVICE: &str = "com.vaporlensdb.encryption-key";
const KEYCHAIN_ACCOUNT: &str = "VaporLensDB";

pub fn encrypt_password(config_dir: &Path, plaintext: &str) -> Result<String, AppError> {
    let cipher = cipher(config_dir)?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|error| AppError::AuthError(format!("encrypt password failed: {error}")))?;

    Ok(format!(
        "{}:{}",
        STANDARD.encode(nonce.as_slice()),
        STANDARD.encode(ciphertext)
    ))
}

pub fn decrypt_password(config_dir: &Path, encrypted: &str) -> Result<String, AppError> {
    let (nonce, ciphertext) = encrypted
        .split_once(':')
        .ok_or_else(|| AppError::AuthError("invalid encrypted password payload".to_string()))?;
    let nonce = STANDARD
        .decode(nonce)
        .map_err(|error| AppError::AuthError(format!("decode password nonce failed: {error}")))?;
    let ciphertext = STANDARD.decode(ciphertext).map_err(|error| {
        AppError::AuthError(format!("decode encrypted password failed: {error}"))
    })?;

    let cipher = cipher(config_dir)?;
    let plaintext = cipher
        .decrypt(nonce.as_slice().into(), ciphertext.as_ref())
        .map_err(|error| AppError::AuthError(format!("decrypt password failed: {error}")))?;

    String::from_utf8(plaintext)
        .map_err(|error| AppError::AuthError(format!("password is not valid UTF-8: {error}")))
}

fn cipher(config_dir: &Path) -> Result<Aes256Gcm, AppError> {
    let key = load_or_create_key(config_dir)?;
    Ok(Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key)))
}

fn load_or_create_key(config_dir: &Path) -> Result<[u8; 32], AppError> {
    #[cfg(target_os = "macos")]
    {
        if std::env::var("VAPORLENSDB_USE_DEV_KEY").as_deref() != Ok("1") {
            return load_or_create_macos_keychain_key();
        }
    }

    load_or_create_dev_key(config_dir)
}

#[cfg(target_os = "macos")]
fn load_or_create_macos_keychain_key() -> Result<[u8; 32], AppError> {
    match read_macos_keychain_secret()? {
        Some(secret) => decode_key(&secret, "macOS Keychain"),
        None => {
            let key = Aes256Gcm::generate_key(&mut OsRng);
            let encoded = STANDARD.encode(key.as_slice());
            write_macos_keychain_secret(&encoded)?;

            let mut key_bytes = [0_u8; 32];
            key_bytes.copy_from_slice(key.as_slice());
            Ok(key_bytes)
        }
    }
}

#[cfg(target_os = "macos")]
fn read_macos_keychain_secret() -> Result<Option<String>, AppError> {
    let output = Command::new("/usr/bin/security")
        .args([
            "find-generic-password",
            "-a",
            KEYCHAIN_ACCOUNT,
            "-s",
            KEYCHAIN_SERVICE,
            "-w",
        ])
        .output()?;

    if output.status.success() {
        let secret = String::from_utf8(output.stdout).map_err(|error| {
            AppError::AuthError(format!("macOS Keychain value is not valid UTF-8: {error}"))
        })?;
        return Ok(Some(secret.trim().to_string()));
    }

    Ok(None)
}

#[cfg(target_os = "macos")]
fn write_macos_keychain_secret(secret: &str) -> Result<(), AppError> {
    let output = Command::new("/usr/bin/security")
        .args([
            "add-generic-password",
            "-a",
            KEYCHAIN_ACCOUNT,
            "-s",
            KEYCHAIN_SERVICE,
            "-w",
            secret,
            "-U",
        ])
        .output()?;

    if output.status.success() {
        Ok(())
    } else {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(AppError::AuthError(format!(
            "write macOS Keychain secret failed: {message}"
        )))
    }
}

fn load_or_create_dev_key(config_dir: &Path) -> Result<[u8; 32], AppError> {
    fs::create_dir_all(config_dir)?;
    let path = key_path(config_dir);

    if path.exists() {
        let encoded = fs::read_to_string(&path)?;
        return decode_key(encoded.trim(), "development key");
    }

    let key = Aes256Gcm::generate_key(&mut OsRng);
    fs::write(&path, STANDARD.encode(key.as_slice()))?;

    let mut key_bytes = [0_u8; 32];
    key_bytes.copy_from_slice(key.as_slice());
    Ok(key_bytes)
}

fn key_path(config_dir: &Path) -> PathBuf {
    config_dir.join(KEY_FILE)
}

fn decode_key(encoded: &str, source: &str) -> Result<[u8; 32], AppError> {
    let bytes = STANDARD
        .decode(encoded.trim())
        .map_err(|error| AppError::AuthError(format!("decode {source} failed: {error}")))?;

    bytes
        .try_into()
        .map_err(|_| AppError::AuthError(format!("{source} must be 32 bytes")))
}

#[cfg(test)]
mod tests {
    use super::{decrypt_password, encrypt_password};

    #[test]
    fn encrypts_and_decrypts_password() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let dir =
            std::env::temp_dir().join(format!("vaporlensdb-crypto-test-{}", uuid::Uuid::new_v4()));

        let encrypted = encrypt_password(&dir, "postgres123").expect("encrypt password");
        assert!(!encrypted.contains("postgres123"));

        let decrypted = decrypt_password(&dir, &encrypted).expect("decrypt password");
        assert_eq!(decrypted, "postgres123");
    }
}
