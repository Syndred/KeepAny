use tauri::AppHandle;
use uuid::{Uuid, Variant, Version};

type KeychainResult<T> = Result<T, &'static str>;
const UNAVAILABLE: &str = "remembered-vault-key-unavailable";

fn valid_profile(profile: &str) -> bool {
    Uuid::try_parse(profile).is_ok_and(|id| {
        id.get_version() == Some(Version::Random)
            && id.get_variant() == Variant::RFC4122
            && id.to_string() == profile
    })
}

async fn with_keychain<T: Send + 'static>(
    app: AppHandle,
    profile: String,
    operation: impl FnOnce(&str, &str) -> KeychainResult<T> + Send + 'static,
) -> KeychainResult<T> {
    if !valid_profile(&profile) {
        return Err("remembered-vault-key-invalid");
    }
    let service = format!("{}.vault-unlock-v1", app.config().identifier);
    tauri::async_runtime::spawn_blocking(move || operation(&service, &profile))
        .await
        .map_err(|_| UNAVAILABLE)?
}

#[tauri::command]
pub async fn save_remembered_vault_key(
    app: AppHandle,
    profile: String,
    value: Vec<u8>,
) -> KeychainResult<()> {
    with_keychain(app, profile, |service, account| {
        platform::save(service, account, value)
    })
    .await
}

#[tauri::command]
pub async fn load_remembered_vault_key(
    app: AppHandle,
    profile: String,
) -> KeychainResult<Option<Vec<u8>>> {
    with_keychain(app, profile, platform::load).await
}

#[tauri::command]
pub async fn forget_remembered_vault_key(app: AppHandle, profile: String) -> KeychainResult<()> {
    with_keychain(app, profile, platform::forget).await
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{KeychainResult, UNAVAILABLE};
    use security_framework::passwords::{
        delete_generic_password, get_generic_password, set_generic_password,
    };
    use zeroize::{Zeroize, Zeroizing};

    // A 16-byte vault UUID followed by the 32-byte KDBX password hash.
    const KEY_LENGTH: usize = 48;
    const ITEM_NOT_FOUND: i32 = -25300; // errSecItemNotFound

    pub fn save(service: &str, account: &str, value: Vec<u8>) -> KeychainResult<()> {
        let value = Zeroizing::new(value);
        if value.len() != KEY_LENGTH {
            return Err("remembered-vault-key-invalid");
        }
        set_generic_password(service, account, &value).map_err(|_| UNAVAILABLE)
    }

    pub fn load(service: &str, account: &str) -> KeychainResult<Option<Vec<u8>>> {
        match get_generic_password(service, account) {
            Ok(value) if value.len() == KEY_LENGTH => Ok(Some(value)),
            Ok(mut value) => {
                value.zeroize();
                Err("remembered-vault-key-invalid")
            }
            Err(error) if error.code() == ITEM_NOT_FOUND => Ok(None),
            Err(_) => Err(UNAVAILABLE),
        }
    }

    pub fn forget(service: &str, account: &str) -> KeychainResult<()> {
        match delete_generic_password(service, account) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == ITEM_NOT_FOUND => Ok(()),
            Err(_) => Err(UNAVAILABLE),
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::{KeychainResult, UNAVAILABLE};

    pub fn save(_service: &str, _account: &str, _value: Vec<u8>) -> KeychainResult<()> {
        Err(UNAVAILABLE)
    }

    pub fn load(_service: &str, _account: &str) -> KeychainResult<Option<Vec<u8>>> {
        Err(UNAVAILABLE)
    }

    pub fn forget(_service: &str, _account: &str) -> KeychainResult<()> {
        Err(UNAVAILABLE)
    }
}

#[cfg(test)]
mod tests {
    use super::valid_profile;

    #[test]
    fn accepts_only_canonical_v4_profile_ids() {
        assert!(valid_profile("a0123456-7890-4567-8123-4567890abcde"));
        for invalid in [
            "A0123456-7890-4567-8123-4567890ABCDE",
            "a01234567890456781234567890abcde",
            "a0123456-7890-1567-8123-4567890abcde",
            "a0123456-7890-4567-0123-4567890abcde",
            "local",
        ] {
            assert!(!valid_profile(invalid));
        }
    }
}
