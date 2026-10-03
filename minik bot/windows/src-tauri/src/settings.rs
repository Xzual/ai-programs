// Preferences, stored as plain JSON in %APPDATA%\Coucou\settings.json.
// No secret ever lands here — API keys live in the Windows Credential Manager.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default)]
    pub bar: BarPreferences,
    pub sound_enabled: bool,
    pub sound_volume: f64,
    pub auto_close_interval: f64,
    pub absence_interval: f64,
    pub active_integrations: Vec<String>,
    /// "primary" = the main display, "cursor" = whichever display the mouse is on.
    pub screen: String,
    pub autostart: bool,
    pub hooks_installed: bool,
    /// Gemini model used by the chat. Changeable in the settings window.
    /// Defaulted explicitly so a settings.json written by an older build still loads.
    #[serde(default = "default_model")]
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct BarPreferences { pub width: f64, pub compact_width: f64, pub position: String, pub accent: String, pub hide_fullscreen: bool, #[serde(default)] pub download_notifications: bool, pub pinned: Vec<String> }
impl Default for BarPreferences { fn default() -> Self { Self { width:640.,compact_width:288.,position:"center".into(),accent:"#7c5cff".into(),hide_fullscreen:true,download_notifications:false,pinned:vec!["shortcuts".into(),"shelf".into(),"downloads".into(),"spotify".into(),"notifications".into(),"clipboard".into()] } } }
impl BarPreferences {
    pub fn normalize(&mut self) {
        self.width=if self.width.is_finite(){self.width.clamp(420.,640.)}else{640.};
        self.compact_width=if self.compact_width.is_finite(){self.compact_width.clamp(240.,400.)}else{288.};
        if !["left","center","right"].contains(&self.position.as_str()){self.position="center".into();}
        if self.accent.len()!=7 || !self.accent.starts_with('#') || !self.accent[1..].bytes().all(|c|c.is_ascii_hexdigit()){self.accent="#7c5cff".into();}
        let mut seen=std::collections::HashSet::new();self.pinned.retain(|s|["shortcuts","shelf","downloads","spotify","notifications","clipboard"].contains(&s.as_str())&&seen.insert(s.clone()));
    }
}

fn default_model() -> String {
    crate::gemini::DEFAULT_MODEL.to_string()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            bar:BarPreferences::default(),
            sound_enabled: true,
            sound_volume: 0.12,
            auto_close_interval: 15.0,
            absence_interval: 180.0,
            active_integrations: vec![
                "integration_resend".into(),
                "integration_n8n".into(),
                "integration_codex".into(),
                "integration_github".into(),
            ],
            screen: "primary".into(),
            autostart: false,
            hooks_installed: false,
            model: default_model(),
        }
    }
}

/// %APPDATA%\Coucou
pub fn config_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Coucou")
}

/// %LOCALAPPDATA%\Coucou — where coucou-hook.exe and the log live.
pub fn local_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Coucou")
}

pub fn hook_exe_path() -> PathBuf {
    local_dir().join("bin").join("coucou-hook.exe")
}

fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

pub fn load() -> Settings {
    match std::fs::read(settings_path()) {
        Ok(bytes) => {
            migrated(serde_json::from_slice(&bytes).unwrap_or_default())
        },
        Err(_) => Settings::default(),
    }
}

fn migrated(mut settings: Settings) -> Settings {
    settings.bar.normalize();
    if !settings.model.starts_with("gemini-") { settings.model = default_model(); }
    for id in &mut settings.active_integrations { if id == "integration_vercel" { *id = "integration_codex".into(); } }
    let mut seen = std::collections::HashSet::new();
    settings.active_integrations.retain(|id| seen.insert(id.clone()));
    settings
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bar_defaults_preserve_legacy_settings() {
        let mut value = serde_json::to_value(Settings::default()).unwrap();
        value.as_object_mut().unwrap().remove("bar");
        let old: Settings = serde_json::from_value(value).unwrap();
        assert_eq!(old.bar.width, 640.0);
        assert!(old.bar.hide_fullscreen);
    }
    #[test]
    fn bar_preferences_are_bounded_and_deduplicated() {
        let mut bar = BarPreferences::default();
        bar.width = f64::NAN; bar.compact_width = 900.0;
        bar.position = "invalid".into(); bar.accent = "javascript:bad".into();
        bar.pinned = vec!["shelf".into(), "shelf".into(), "unknown".into()];
        bar.normalize();
        assert_eq!(bar.width, 640.0); assert_eq!(bar.compact_width, 400.0);
        assert_eq!(bar.position, "center"); assert_eq!(bar.accent, "#7c5cff");
        assert_eq!(bar.pinned, vec!["shelf"]);
    }
    #[test]
    fn migrates_old_provider_and_pill_without_changing_preferences() {
        let mut old = Settings::default();
        old.model = "claude-sonnet-4".into();
        old.sound_volume = 0.07;
        old.screen = "cursor".into();
        old.active_integrations = vec!["integration_vercel".into(), "integration_github".into(), "integration_codex".into()];
        let next = migrated(old);
        assert_eq!(next.model, crate::gemini::DEFAULT_MODEL);
        assert_eq!(next.active_integrations, vec!["integration_codex", "integration_github"]);
        assert_eq!(next.sound_volume, 0.07);
        assert_eq!(next.screen, "cursor");
        let next = migrated(Settings { model: "gemini-2.5-flash".into(), ..next });
        assert_eq!(next.model, "gemini-2.5-flash");
    }
}

pub fn save(settings: &Settings) -> std::io::Result<()> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir)?;
    let json = serde_json::to_vec_pretty(settings)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(settings_path(), json)
}
