use std::{
    fs,
    path::{Path, PathBuf},
};

#[cfg(test)]
use std::cell::Cell;

#[cfg(unix)]
use std::io::Write;
#[cfg(target_os = "linux")]
use std::process::{Command, Stdio};

#[cfg(target_os = "macos")]
use core_foundation::{
    base::{TCFType, ToVoid},
    data::CFData,
    dictionary::CFMutableDictionary,
    string::CFString,
};
#[cfg(target_os = "macos")]
use security_framework::item::{ItemClass, ItemSearchOptions, SearchResult};
#[cfg(target_os = "macos")]
use security_framework_sys::{
    item::{
        kSecAttrAccount, kSecAttrLabel, kSecAttrService, kSecClass, kSecClassGenericPassword,
        kSecUseAuthenticationUI, kSecUseAuthenticationUISkip, kSecValueData,
    },
    keychain_item::SecItemAdd,
};

use aes_gcm::{
    aead::{Aead, AeadCore, Generate, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use zeroize::Zeroizing;

use crate::models::error::AppError;

const KEY_FILE: &str = "dev-secret.key";
#[cfg(target_os = "windows")]
const WINDOWS_KEY_FILE: &str = "os-secret.key";
#[cfg(target_os = "macos")]
const KEYCHAIN_SERVICE: &str = "com.vaporlensdb.encryption-key.v4";
#[cfg(target_os = "macos")]
const KEYCHAIN_ACCOUNT: &str = "VaporLensDB";
/// The only macOS Keychain service used for normal datasource passwords.
///
/// The account is an opaque, per-save UUID rather than a connection name. This
/// makes a saved password independent of user-editable datasource metadata and
/// lets a re-save create a clean credential without probing an inaccessible
/// item left by an earlier build.
#[cfg(target_os = "macos")]
const MACOS_DATASOURCE_PASSWORD_SERVICE: &str = "com.vaporlensdb.datasource-password.v1";
#[cfg(target_os = "macos")]
const MACOS_DATASOURCE_PASSWORD_REFERENCE_PREFIX: &str = "macos-keychain-v1:";
#[cfg(target_os = "macos")]
const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;
#[cfg(target_os = "macos")]
const ERR_SEC_DUPLICATE_ITEM: i32 = -25299;
#[cfg(target_os = "macos")]
const ERR_SEC_AUTH_FAILED: i32 = -25293;
#[cfg(target_os = "macos")]
const ERR_SEC_INTERACTION_NOT_ALLOWED: i32 = -25308;
const CURRENT_CIPHERTEXT_PREFIX: &str = "v4:";

#[cfg(test)]
thread_local! {
    static KEY_RESOLUTION_COUNT: Cell<u32> = const { Cell::new(0) };
}

#[cfg(test)]
fn note_key_resolution() {
    KEY_RESOLUTION_COUNT.with(|count| count.set(count.get() + 1));
}

#[cfg(test)]
fn reset_key_resolution_count() {
    KEY_RESOLUTION_COUNT.with(|count| count.set(0));
}

#[cfg(test)]
fn key_resolution_count() -> u32 {
    KEY_RESOLUTION_COUNT.with(Cell::get)
}

/// A scoped resolver for one logical credential operation. It does not escape
/// the operation, so the encryption key is not kept in global application
/// state. It also prevents password plus SSH-secret handling from repeatedly
/// reading the active credential-store item within that operation.
pub struct SecretOperation<'a> {
    config_dir: &'a Path,
    current_key: Option<Zeroizing<[u8; 32]>>,
}

pub struct DecryptedSecret {
    pub plaintext: String,
}

impl<'a> SecretOperation<'a> {
    pub fn new(config_dir: &'a Path) -> Self {
        Self {
            config_dir,
            current_key: None,
        }
    }

    pub fn encrypt(&mut self, plaintext: &str) -> Result<String, AppError> {
        let encrypted = encrypt_with_key(self.current_key()?, plaintext)?;
        Ok(format!("{CURRENT_CIPHERTEXT_PREFIX}{encrypted}"))
    }

    pub fn decrypt(&mut self, encrypted: &str) -> Result<DecryptedSecret, AppError> {
        #[cfg(target_os = "macos")]
        let ciphertext = encrypted
            .strip_prefix(CURRENT_CIPHERTEXT_PREFIX)
            // Never inspect or probe an older macOS Keychain generation. The
            // user re-enters the database password to create a V4 credential.
            .ok_or_else(saved_credential_unavailable)?;

        #[cfg(not(target_os = "macos"))]
        // Non-macOS implementations retain their pre-V4 encrypted-record
        // compatibility. macOS deliberately does not: V1/V2/V3 could carry
        // interactive Keychain ACL state and are completely inert at runtime.
        let ciphertext = encrypted
            .strip_prefix(CURRENT_CIPHERTEXT_PREFIX)
            .unwrap_or(encrypted);

        Ok(DecryptedSecret {
            plaintext: decrypt_with_key(self.current_key()?, ciphertext)?,
        })
    }

    fn current_key(&mut self) -> Result<&[u8; 32], AppError> {
        if self.current_key.is_none() {
            #[cfg(test)]
            note_key_resolution();
            self.current_key = Some(Zeroizing::new(load_or_create_current_key(self.config_dir)?));
        }
        Ok(self
            .current_key
            .as_ref()
            .expect("current key was initialized"))
    }
}

pub fn key_backend_label() -> &'static str {
    if use_dev_key() {
        return "local development key file";
    }
    #[cfg(target_os = "macos")]
    {
        "macOS Keychain"
    }
    #[cfg(target_os = "windows")]
    {
        "Windows DPAPI"
    }
    #[cfg(target_os = "linux")]
    {
        "Linux Secret Service"
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        "unsupported platform credential store"
    }
}

pub fn encrypt_password(config_dir: &Path, plaintext: &str) -> Result<String, AppError> {
    SecretOperation::new(config_dir).encrypt(plaintext)
}

pub fn decrypt_password(config_dir: &Path, encrypted: &str) -> Result<String, AppError> {
    decrypt_password_with_operation(&mut SecretOperation::new(config_dir), encrypted)
        .map(|secret| secret.plaintext)
}

pub fn decrypt_password_with_operation(
    operation: &mut SecretOperation<'_>,
    encrypted: &str,
) -> Result<DecryptedSecret, AppError> {
    operation.decrypt(encrypted)
}

/// Store one datasource password directly in the macOS Keychain.
///
/// Normal macOS datasource credentials deliberately do not use the historical
/// "Keychain master key -> AES payload in config.db" arrangement. The config
/// database retains only the opaque returned reference. Each save gets a fresh
/// account identifier, so this path never has to update or inspect a possibly
/// authorization-gated prior item.
#[cfg(target_os = "macos")]
pub fn store_macos_datasource_password(
    config_dir: &Path,
    password: &str,
) -> Result<String, AppError> {
    // Unit tests use the explicit local development backend rather than the
    // developer's login Keychain. Production builds always take the direct
    // Keychain branch below.
    if use_dev_key() {
        let encrypted = encrypt_password(config_dir, password)?;
        return Ok(format!(
            "{MACOS_DATASOURCE_PASSWORD_REFERENCE_PREFIX}dev:{encrypted}"
        ));
    }

    let account = uuid::Uuid::new_v4().to_string();

    // This creates a brand-new opaque account only. It never updates or
    // probes V1/V2/V3/master-key records, so an old ACL cannot cause an
    // authorization dialog here.
    match add_macos_generic_password_silently(
        MACOS_DATASOURCE_PASSWORD_SERVICE,
        &account,
        "VaporLensDB saved datasource password",
        password.as_bytes(),
    ) {
        Ok(()) => Ok(format!(
            "{MACOS_DATASOURCE_PASSWORD_REFERENCE_PREFIX}{account}"
        )),
        Err(error) if is_silent_keychain_unavailable(error.code()) => {
            Err(saved_credential_unavailable())
        }
        Err(error) => Err(macos_keychain_error(
            "write datasource password",
            error.code(),
        )),
    }
}

/// Resolve a direct macOS datasource-password reference without ever allowing
/// Security.framework to present authentication UI.
#[cfg(target_os = "macos")]
pub fn read_macos_datasource_password(
    config_dir: &Path,
    reference: &str,
) -> Result<DecryptedSecret, AppError> {
    let account = reference
        .strip_prefix(MACOS_DATASOURCE_PASSWORD_REFERENCE_PREFIX)
        .ok_or_else(saved_credential_unavailable)?;

    if let Some(encrypted) = account.strip_prefix("dev:") {
        return decrypt_password(config_dir, encrypted)
            .map(|plaintext| DecryptedSecret { plaintext });
    }

    // Do not query arbitrary config text as a Keychain account. A valid
    // opaque UUID is the sole supported V1 direct-password reference.
    if uuid::Uuid::parse_str(account).is_err() {
        return Err(saved_credential_unavailable());
    }

    let mut search = ItemSearchOptions::new();
    search
        .class(ItemClass::generic_password())
        .service(MACOS_DATASOURCE_PASSWORD_SERVICE)
        .account(account)
        .load_data(true)
        // Maps to kSecUseAuthenticationUISkip. A read may succeed silently or
        // return an app error; it must never ask for the macOS login password.
        .skip_authenticated_items(true);
    match search.search() {
        Ok(results) => match results.into_iter().next() {
            Some(SearchResult::Data(secret)) => {
                let plaintext =
                    String::from_utf8(secret).map_err(|_| saved_credential_unavailable())?;
                Ok(DecryptedSecret { plaintext })
            }
            None | Some(_) => Err(saved_credential_unavailable()),
        },
        Err(error) if is_silent_keychain_unavailable(error.code()) => {
            Err(saved_credential_unavailable())
        }
        Err(error) => Err(macos_keychain_error(
            "silent read datasource password",
            error.code(),
        )),
    }
}

/// Remove only a direct V1 datasource-password item, with authentication UI
/// forbidden. Failure to remove an inaccessible item is intentionally silent:
/// config metadata still stops referencing it, and normal app use must never
/// surface a system authorization dialog for cleanup.
#[cfg(target_os = "macos")]
pub fn remove_macos_datasource_password(reference: &str) -> Result<(), AppError> {
    let Some(account) = reference.strip_prefix(MACOS_DATASOURCE_PASSWORD_REFERENCE_PREFIX) else {
        return Ok(());
    };
    if account.starts_with("dev:") || uuid::Uuid::parse_str(account).is_err() {
        return Ok(());
    }

    let mut search = ItemSearchOptions::new();
    search
        .class(ItemClass::generic_password())
        .service(MACOS_DATASOURCE_PASSWORD_SERVICE)
        .account(account)
        .skip_authenticated_items(true);
    match search.delete() {
        Ok(()) => Ok(()),
        Err(error) if is_silent_keychain_unavailable(error.code()) => Ok(()),
        Err(error) => Err(macos_keychain_error(
            "silent delete datasource password",
            error.code(),
        )),
    }
}

#[cfg(target_os = "macos")]
pub fn is_macos_datasource_password_reference(value: &str) -> bool {
    value.starts_with(MACOS_DATASOURCE_PASSWORD_REFERENCE_PREFIX)
}

/// Adds a generic-password Keychain item with authentication UI explicitly
/// forbidden. The high-level crate exposes this flag for lookups but not adds,
/// so the single macOS gateway uses the native call here. A locked Keychain
/// must return an OSStatus to VaporLensDB, never a system password sheet.
#[cfg(target_os = "macos")]
fn add_macos_generic_password_silently(
    service: &str,
    account: &str,
    label: &str,
    secret: &[u8],
) -> Result<(), security_framework::base::Error> {
    let service = CFString::new(service);
    let account = CFString::new(account);
    let label = CFString::new(label);
    let secret = CFData::from_buffer(secret);
    // SAFETY: Security.framework owns these immutable constants for the
    // process lifetime. The wrapper retains the generic-password class.
    let class = unsafe { CFString::wrap_under_get_rule(kSecClassGenericPassword) };
    let mut attributes = CFMutableDictionary::from_CFType_pairs(&[]);
    // SAFETY: all Core Foundation keys and values remain alive through the
    // synchronous SecItemAdd call; no result object is requested.
    let status = unsafe {
        attributes.add(&kSecClass.to_void(), &class.to_void());
        attributes.add(&kSecAttrService.to_void(), &service.to_void());
        attributes.add(&kSecAttrAccount.to_void(), &account.to_void());
        attributes.add(&kSecAttrLabel.to_void(), &label.to_void());
        attributes.add(&kSecValueData.to_void(), &secret.to_void());
        attributes.add(
            &kSecUseAuthenticationUI.to_void(),
            &kSecUseAuthenticationUISkip.to_void(),
        );
        SecItemAdd(
            attributes.to_immutable().as_concrete_TypeRef(),
            std::ptr::null_mut(),
        )
    };
    if status == 0 {
        Ok(())
    } else {
        Err(security_framework::base::Error::from_code(status))
    }
}

fn encrypt_with_key(key: &[u8; 32], plaintext: &str) -> Result<String, AppError> {
    let cipher = Aes256Gcm::new(&Key::<Aes256Gcm>::from(*key));
    let nonce = Nonce::<<Aes256Gcm as AeadCore>::NonceSize>::generate();
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|error| AppError::AuthError(format!("encrypt password failed: {error}")))?;

    Ok(format!(
        "{}:{}",
        STANDARD.encode(nonce.as_slice()),
        STANDARD.encode(ciphertext)
    ))
}

fn decrypt_with_key(key: &[u8; 32], encrypted: &str) -> Result<String, AppError> {
    let (nonce, ciphertext) = encrypted
        .split_once(':')
        .ok_or_else(|| AppError::AuthError("invalid encrypted password payload".to_string()))?;
    let nonce = STANDARD
        .decode(nonce)
        .map_err(|error| AppError::AuthError(format!("decode password nonce failed: {error}")))?;
    let ciphertext = STANDARD.decode(ciphertext).map_err(|error| {
        AppError::AuthError(format!("decode encrypted password failed: {error}"))
    })?;

    let cipher = Aes256Gcm::new(&Key::<Aes256Gcm>::from(*key));
    let nonce = Nonce::<<Aes256Gcm as AeadCore>::NonceSize>::try_from(nonce.as_slice())
        .map_err(|_| AppError::AuthError("invalid encrypted password nonce".to_string()))?;
    let plaintext = cipher
        .decrypt(&nonce, ciphertext.as_ref())
        .map_err(|error| AppError::AuthError(format!("decrypt password failed: {error}")))?;

    String::from_utf8(plaintext)
        .map_err(|error| AppError::AuthError(format!("password is not valid UTF-8: {error}")))
}

fn load_or_create_current_key(config_dir: &Path) -> Result<[u8; 32], AppError> {
    if use_dev_key() {
        return load_or_create_dev_key(config_dir);
    }
    #[cfg(target_os = "macos")]
    {
        load_or_create_macos_keychain_key()
    }
    #[cfg(target_os = "windows")]
    {
        load_or_create_windows_key(config_dir)
    }
    #[cfg(target_os = "linux")]
    {
        load_or_create_linux_secret_service_key(config_dir)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Err(AppError::AuthError(
            "no production credential store is available on this platform".to_string(),
        ))
    }
}

fn use_dev_key() -> bool {
    std::env::var("VAPORLENSDB_USE_DEV_KEY").as_deref() == Ok("1")
}

#[cfg(target_os = "macos")]
fn load_or_create_macos_keychain_key() -> Result<[u8; 32], AppError> {
    match read_macos_keychain_secret()? {
        Some(secret) => decode_key(&secret, "macOS Keychain"),
        None => {
            let key = new_key();
            let encoded = STANDARD.encode(key);
            write_macos_keychain_secret(&encoded)?;
            Ok(key)
        }
    }
}

#[cfg(target_os = "macos")]
fn read_macos_keychain_secret() -> Result<Option<String>, AppError> {
    // `kSecUseAuthenticationUISkip` is essential product policy: this query
    // must either return data silently or fail in VaporLensDB. Security.framework
    // is never allowed to put up a login-password/Touch ID dialog during normal
    // database use.
    let mut search = ItemSearchOptions::new();
    search
        .class(ItemClass::generic_password())
        .service(KEYCHAIN_SERVICE)
        .account(KEYCHAIN_ACCOUNT)
        .load_data(true)
        .skip_authenticated_items(true);
    match search.search() {
        Ok(results) => match results.into_iter().next() {
            Some(SearchResult::Data(secret)) => decode_macos_keychain_secret(secret),
            // Authentication-required records are deliberately skipped. Treat
            // them as unavailable rather than asking macOS to authenticate.
            None | Some(_) => Ok(None),
        },
        // With `kSecUseAuthenticationUISkip`, an inaccessible item may be
        // reported as either auth-failed or interaction-not-allowed. Both
        // mean "not available silently", never "ask macOS to authenticate".
        Err(error) if is_silent_keychain_unavailable(error.code()) => Ok(None),
        Err(error) => Err(macos_keychain_error("silent read", error.code())),
    }
}

#[cfg(target_os = "macos")]
fn is_silent_keychain_unavailable(status: i32) -> bool {
    matches!(
        status,
        ERR_SEC_ITEM_NOT_FOUND | ERR_SEC_AUTH_FAILED | ERR_SEC_INTERACTION_NOT_ALLOWED
    )
}

#[cfg(target_os = "macos")]
fn decode_macos_keychain_secret(secret: Vec<u8>) -> Result<Option<String>, AppError> {
    let secret = String::from_utf8(secret).map_err(|error| {
        AppError::AuthError(format!("macOS Keychain value is not valid UTF-8: {error}"))
    })?;
    Ok(Some(secret.trim().to_string()))
}

#[cfg(target_os = "macos")]
fn write_macos_keychain_secret(secret: &str) -> Result<(), AppError> {
    // Create-only deliberately avoids an update of an inaccessible item. A
    // duplicate means the item was not silently readable and is surfaced as a
    // controlled credential re-entry error rather than an authorization UI.
    match add_macos_generic_password_silently(
        KEYCHAIN_SERVICE,
        KEYCHAIN_ACCOUNT,
        "VaporLensDB encryption key",
        secret.as_bytes(),
    ) {
        Ok(()) => Ok(()),
        Err(error) if error.code() == ERR_SEC_DUPLICATE_ITEM => Err(saved_credential_unavailable()),
        Err(error) => Err(macos_keychain_error("write", error.code())),
    }
}

fn saved_credential_unavailable() -> AppError {
    AppError::CredentialUnavailable
}

#[cfg(target_os = "macos")]
fn macos_keychain_error(operation: &str, status: i32) -> AppError {
    // Do not format the secret or Keychain payload. OSStatus is actionable and
    // stable enough for support diagnostics while remaining safe for IPC.
    AppError::AuthError(format!(
        "macOS Keychain {operation} failed (OSStatus {status})"
    ))
}

#[cfg(target_os = "linux")]
fn load_or_create_linux_secret_service_key(config_dir: &Path) -> Result<[u8; 32], AppError> {
    if let Some(secret) = read_linux_secret_service_secret()? {
        return decode_key(&secret, "Linux Secret Service");
    }
    let key = migrated_or_new_key(config_dir)?;
    write_linux_secret_service_secret(&STANDARD.encode(key))?;
    remove_legacy_dev_key(config_dir)?;
    Ok(key)
}

#[cfg(target_os = "linux")]
fn read_linux_secret_service_secret() -> Result<Option<String>, AppError> {
    let output = Command::new("secret-tool")
        .args([
            "lookup",
            "service",
            "com.vaporlensdb.encryption-key",
            "account",
            "VaporLensDB",
        ])
        .output()
        .map_err(|error| {
            AppError::AuthError(format!(
                "Linux password storage requires secret-tool and an active Secret Service session (install libsecret-tools on Debian/Ubuntu): {error}"
            ))
        })?;
    if output.status.success() {
        let secret = String::from_utf8(output.stdout).map_err(|error| {
            AppError::AuthError(format!("Secret Service value is not UTF-8: {error}"))
        })?;
        return Ok((!secret.trim().is_empty()).then(|| secret.trim().to_string()));
    }
    if output.status.code() == Some(1) {
        return Ok(None);
    }
    Err(AppError::AuthError(format!(
        "read Linux Secret Service failed: {}",
        String::from_utf8_lossy(&output.stderr).trim()
    )))
}

#[cfg(target_os = "linux")]
fn write_linux_secret_service_secret(secret: &str) -> Result<(), AppError> {
    let mut child = Command::new("secret-tool")
        .args([
            "store",
            "--label=VaporLensDB encryption key",
            "service",
            "com.vaporlensdb.encryption-key",
            "account",
            "VaporLensDB",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            AppError::AuthError(format!(
                "Linux password storage requires secret-tool and an active Secret Service session (install libsecret-tools on Debian/Ubuntu): {error}"
            ))
        })?;
    child
        .stdin
        .take()
        .ok_or_else(|| AppError::AuthError("open secret-tool stdin failed".to_string()))?
        .write_all(secret.as_bytes())?;
    let output = child.wait_with_output()?;
    if output.status.success() {
        Ok(())
    } else {
        Err(AppError::AuthError(format!(
            "write Linux Secret Service failed; verify that the desktop Secret Service session is active: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )))
    }
}

#[cfg(target_os = "windows")]
fn load_or_create_windows_key(config_dir: &Path) -> Result<[u8; 32], AppError> {
    let path = config_dir.join(WINDOWS_KEY_FILE);
    if path.exists() {
        return windows_unprotect_key(&fs::read(path)?);
    }
    fs::create_dir_all(config_dir)?;
    let key = migrated_or_new_key(config_dir)?;
    fs::write(&path, windows_protect_key(&key)?)?;
    remove_legacy_dev_key(config_dir)?;
    Ok(key)
}

#[cfg(target_os = "windows")]
#[derive(Default)]
struct DpapiOutputBlob(windows_sys::Win32::Security::Cryptography::CRYPT_INTEGER_BLOB);

#[cfg(target_os = "windows")]
impl DpapiOutputBlob {
    fn as_mut_ptr(
        &mut self,
    ) -> *mut windows_sys::Win32::Security::Cryptography::CRYPT_INTEGER_BLOB {
        &mut self.0
    }

    fn to_vec(&self) -> Result<Vec<u8>, AppError> {
        if self.0.cbData == 0 {
            return Ok(Vec::new());
        }
        if self.0.pbData.is_null() {
            return Err(AppError::AuthError(
                "Windows DPAPI returned an invalid output buffer".to_string(),
            ));
        }

        // SAFETY: DPAPI returned a non-null buffer containing exactly cbData bytes.
        // The buffer remains owned by this wrapper until Drop calls LocalFree.
        Ok(unsafe { std::slice::from_raw_parts(self.0.pbData, self.0.cbData as usize).to_vec() })
    }
}

#[cfg(target_os = "windows")]
impl Drop for DpapiOutputBlob {
    fn drop(&mut self) {
        if self.0.pbData.is_null() {
            return;
        }
        // SAFETY: CryptProtectData/CryptUnprotectData allocate pbData with LocalAlloc,
        // and this wrapper is the sole owner responsible for releasing it once.
        unsafe {
            windows_sys::Win32::Foundation::LocalFree(self.0.pbData.cast());
        }
    }
}

#[cfg(target_os = "windows")]
fn windows_protect_key(key: &[u8; 32]) -> Result<Vec<u8>, AppError> {
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: key.len() as u32,
        pbData: key.as_ptr() as *mut u8,
    };
    let mut output = DpapiOutputBlob::default();
    // SAFETY: input references the 32-byte key for the duration of the call;
    // all optional pointers are null as allowed by CryptProtectData, and output
    // points to writable storage owned by DpapiOutputBlob.
    let success = unsafe {
        CryptProtectData(
            &input,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            output.as_mut_ptr(),
        )
    };
    if success == 0 {
        return Err(AppError::AuthError(format!(
            "Windows DPAPI encryption failed: {}",
            std::io::Error::last_os_error()
        )));
    }
    output.to_vec()
}

#[cfg(target_os = "windows")]
fn windows_unprotect_key(encrypted: &[u8]) -> Result<[u8; 32], AppError> {
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: encrypted.len() as u32,
        pbData: encrypted.as_ptr() as *mut u8,
    };
    let mut output = DpapiOutputBlob::default();
    // SAFETY: input references the encrypted slice for the duration of the call;
    // all optional pointers are null as allowed by CryptUnprotectData, and output
    // points to writable storage owned by DpapiOutputBlob.
    let success = unsafe {
        CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            output.as_mut_ptr(),
        )
    };
    if success == 0 {
        return Err(AppError::AuthError(format!(
            "Windows DPAPI decryption failed: {}",
            std::io::Error::last_os_error()
        )));
    }
    output
        .to_vec()?
        .try_into()
        .map_err(|_| AppError::AuthError("Windows DPAPI key must be 32 bytes".to_string()))
}

fn load_or_create_dev_key(config_dir: &Path) -> Result<[u8; 32], AppError> {
    fs::create_dir_all(config_dir)?;
    let path = key_path(config_dir);

    if path.exists() {
        let encoded = fs::read_to_string(&path)?;
        return decode_key(encoded.trim(), "development key");
    }

    let key = Key::<Aes256Gcm>::generate();
    write_dev_key(&path, &STANDARD.encode(key.as_slice()))?;

    let mut key_bytes = [0_u8; 32];
    key_bytes.copy_from_slice(key.as_slice());
    Ok(key_bytes)
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn migrated_or_new_key(config_dir: &Path) -> Result<[u8; 32], AppError> {
    let legacy = key_path(config_dir);
    if legacy.exists() {
        return decode_key(fs::read_to_string(legacy)?.trim(), "legacy development key");
    }
    Ok(new_key())
}

fn new_key() -> [u8; 32] {
    let key = Key::<Aes256Gcm>::generate();
    let mut bytes = [0_u8; 32];
    bytes.copy_from_slice(key.as_slice());
    bytes
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn remove_legacy_dev_key(config_dir: &Path) -> Result<(), AppError> {
    let path = key_path(config_dir);
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

fn write_dev_key(path: &Path, encoded: &str) -> Result<(), AppError> {
    #[cfg(unix)]
    {
        use std::{fs::OpenOptions, os::unix::fs::OpenOptionsExt};
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)?;
        file.write_all(encoded.as_bytes())?;
        Ok(())
    }
    #[cfg(not(unix))]
    fs::write(path, encoded).map_err(AppError::from)
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
    use std::fs;

    #[cfg(target_os = "macos")]
    use crate::models::error::AppError;

    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    use super::{
        decrypt_password, encrypt_password, key_path, key_resolution_count,
        reset_key_resolution_count, SecretOperation, CURRENT_CIPHERTEXT_PREFIX,
    };

    #[cfg(target_os = "macos")]
    use super::{
        is_silent_keychain_unavailable, macos_keychain_error, read_macos_datasource_password,
        saved_credential_unavailable, store_macos_datasource_password, ERR_SEC_AUTH_FAILED,
        ERR_SEC_INTERACTION_NOT_ALLOWED, ERR_SEC_ITEM_NOT_FOUND, KEYCHAIN_ACCOUNT,
        KEYCHAIN_SERVICE, MACOS_DATASOURCE_PASSWORD_REFERENCE_PREFIX,
        MACOS_DATASOURCE_PASSWORD_SERVICE,
    };

    #[test]
    fn encrypts_and_decrypts_password() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let dir =
            std::env::temp_dir().join(format!("vaporlensdb-crypto-test-{}", uuid::Uuid::new_v4()));

        let encrypted = encrypt_password(&dir, "postgres123").expect("encrypt password");
        assert!(!encrypted.contains("postgres123"));

        let decrypted = decrypt_password(&dir, &encrypted).expect("decrypt password");
        assert_eq!(decrypted, "postgres123");

        fs::remove_dir_all(dir).expect("remove crypto test directory");
    }

    #[test]
    fn scoped_secret_operation_resolves_the_master_key_once() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let dir = std::env::temp_dir().join(format!(
            "vaporlensdb-scoped-crypto-test-{}",
            uuid::Uuid::new_v4()
        ));
        reset_key_resolution_count();

        let mut operation = SecretOperation::new(&dir);
        let first = operation.encrypt("first").expect("encrypt first");
        let second = operation.encrypt("second").expect("encrypt second");
        assert!(first.starts_with(CURRENT_CIPHERTEXT_PREFIX));
        assert_eq!(
            operation.decrypt(&first).expect("decrypt first").plaintext,
            "first"
        );
        assert_eq!(
            operation
                .decrypt(&second)
                .expect("decrypt second")
                .plaintext,
            "second"
        );
        assert_eq!(key_resolution_count(), 1);

        fs::remove_dir_all(dir).expect("remove crypto test directory");
    }

    #[cfg(unix)]
    #[test]
    fn development_key_file_is_owner_only() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let dir = std::env::temp_dir().join(format!(
            "vaporlensdb-key-permissions-test-{}",
            uuid::Uuid::new_v4()
        ));

        encrypt_password(&dir, "secret").expect("create development key");

        let mode = fs::metadata(key_path(&dir))
            .expect("read development key metadata")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);

        fs::remove_dir_all(dir).expect("remove key permission test directory");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_keychain_v4_errors_do_not_echo_secret_data() {
        assert_eq!(KEYCHAIN_SERVICE, "com.vaporlensdb.encryption-key.v4");
        assert_eq!(KEYCHAIN_ACCOUNT, "VaporLensDB");

        let rendered = macos_keychain_error("write", -25293).to_string();
        assert!(rendered.contains("OSStatus -25293"));
        assert!(!rendered.contains("test-secret-value"));
        assert_eq!(
            saved_credential_unavailable().safe_message(),
            "Unable to access the saved database password. Please enter it again."
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn noninteractive_keychain_denials_use_the_controlled_reentry_path() {
        assert!(is_silent_keychain_unavailable(ERR_SEC_ITEM_NOT_FOUND));
        assert!(is_silent_keychain_unavailable(ERR_SEC_AUTH_FAILED));
        assert!(is_silent_keychain_unavailable(
            ERR_SEC_INTERACTION_NOT_ALLOWED
        ));
        assert!(!is_silent_keychain_unavailable(-50));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_datasource_password_reference_keeps_plaintext_out_of_config() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let dir = std::env::temp_dir().join(format!(
            "vaporlensdb-direct-password-test-{}",
            uuid::Uuid::new_v4()
        ));

        let reference = store_macos_datasource_password(&dir, "postgres123")
            .expect("store direct datasource password");
        assert!(reference.starts_with(MACOS_DATASOURCE_PASSWORD_REFERENCE_PREFIX));
        assert!(!reference.contains("postgres123"));
        assert_eq!(
            read_macos_datasource_password(&dir, &reference)
                .expect("read direct datasource password")
                .plaintext,
            "postgres123"
        );
        assert_eq!(
            MACOS_DATASOURCE_PASSWORD_SERVICE,
            "com.vaporlensdb.datasource-password.v1"
        );

        fs::remove_dir_all(dir).expect("remove crypto test directory");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn old_macos_ciphertext_is_unavailable_without_resolving_any_key() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let dir = std::env::temp_dir().join(format!(
            "vaporlensdb-old-credential-test-{}",
            uuid::Uuid::new_v4()
        ));
        reset_key_resolution_count();

        let mut operation = SecretOperation::new(&dir);
        assert!(matches!(
            operation.decrypt("v3:old-ciphertext"),
            Err(AppError::CredentialUnavailable)
        ));
        assert_eq!(key_resolution_count(), 0);
    }
}
