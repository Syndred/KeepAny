#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod export;

use tauri::{webview::NewWindowResponse, Manager, Url, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

fn is_app_url(app: &tauri::AppHandle, url: &Url) -> bool {
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    if tauri::is_dev() {
        if let Some(dev_url) = &app.config().build.dev_url {
            return url.origin() == dev_url.origin();
        }
    }

    let origin = if cfg!(windows) {
        ("http", "tauri.localhost")
    } else {
        ("tauri", "localhost")
    };
    (url.scheme(), url.host_str().unwrap_or_default()) == origin
        && url.port().is_none()
}

fn open_external(app: &tauri::AppHandle, url: &Url) {
    if matches!(url.scheme(), "http" | "https")
        && url.host().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && !is_app_url(app, url)
    {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![export::save_export])
        .setup(|app| {
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .ok_or("missing main window configuration")?;
            let navigation_app = app.handle().clone();
            let popup_app = app.handle().clone();
            let window = WebviewWindowBuilder::from_config(app, config)?;
            let window = if tauri::is_dev() && app.config().build.dev_url.is_some() {
                window.title("KeepAny · 开发预览")
            } else {
                window
            };
            window
                .on_navigation(move |url| {
                    if is_app_url(&navigation_app, url) {
                        return true;
                    }
                    open_external(&navigation_app, url);
                    false
                })
                .on_new_window(move |url, _| {
                    open_external(&popup_app, &url);
                    NewWindowResponse::Deny
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start KeepAny desktop");
}
