fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "save_export",
            "save_remembered_vault_key",
            "load_remembered_vault_key",
            "forget_remembered_vault_key",
        ])),
    )
    .expect("failed to build KeepAny desktop");
}
