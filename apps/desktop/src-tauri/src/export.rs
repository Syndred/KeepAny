use std::{
    io::{self, BufReader, Read, Write},
    path::Path,
};
use tauri::ipc::{InvokeBody, Request};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn save_export(
    window: tauri::WebviewWindow,
    request: Request<'_>,
) -> Result<bool, &'static str> {
    let name = request
        .headers()
        .get("x-keepany-export-name")
        .and_then(|value| value.to_str().ok())
        .filter(|name| {
            name.starts_with("keepany-")
                && name.len() < 80
                && name
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'.'))
        })
        .ok_or("invalid-export-name")?;
    let (extension, magic): (&str, &[u8]) = match name.rsplit_once('.') {
        Some((_, "ka1")) => ("ka1", b"KEEPANY1"),
        Some((_, "kdbx")) => ("kdbx", &[0x03, 0xd9, 0xa2, 0x9a, 0x67, 0xfb, 0x4b, 0xb5]),
        _ => return Err("invalid-export-format"),
    };
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("invalid-export-data");
    };
    if !bytes.starts_with(magic) {
        return Err("invalid-export-data");
    }
    let selected = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_file_name(name)
        .add_filter(extension.to_ascii_uppercase(), &[extension])
        .blocking_save_file();
    let Some(selected) = selected else {
        return Ok(false);
    };
    let path = selected
        .into_path()
        .map_err(|_| "invalid-export-destination")?;
    if !path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case(extension))
    {
        return Err("invalid-export-destination");
    }
    save_verified(&path, bytes).map_err(|_| "export-write-failed")?;
    Ok(true)
}

// Stage the encrypted file beside its destination so a write or verification failure
// leaves any previously saved backup intact.
fn save_verified(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let directory = path.parent().ok_or(io::ErrorKind::InvalidInput)?;
    let mut staged = tempfile::NamedTempFile::new_in(directory)?;
    staged.write_all(bytes)?;
    staged.as_file().sync_all()?;

    let mut reader = BufReader::new(staged.reopen()?);
    let mut buffer = [0; 8192];
    for expected in bytes.chunks(buffer.len()) {
        let actual = &mut buffer[..expected.len()];
        reader.read_exact(actual)?;
        if actual != expected {
            return Err(io::ErrorKind::InvalidData.into());
        }
    }
    if reader.read(&mut buffer[..1])? != 0 {
        return Err(io::ErrorKind::InvalidData.into());
    }
    drop(reader);
    staged.persist(path).map_err(|error| error.error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_an_existing_export_with_verified_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("keepany-test.ka1");
        let bytes = vec![0xA5; 24_123];
        std::fs::write(&path, b"previous").unwrap();
        save_verified(&path, &bytes).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn cleans_up_staged_file_when_destination_cannot_be_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("keepany-test.ka1");
        std::fs::create_dir(&path).unwrap();
        assert!(save_verified(&path, b"encrypted test bytes").is_err());
        assert!(path.is_dir());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
