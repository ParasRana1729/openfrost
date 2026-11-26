use super::{App, ConfirmAction, Dialog, Form, KeyCode, KeyEvent};
use crate::contracts::{AssistantSettings, ExportDestination, SetProviderConfigRequest};

#[derive(Default)]
pub(crate) struct SettingsState {
    pub(crate) settings: Option<AssistantSettings>,
    pub(crate) destinations: Vec<ExportDestination>,
    /// Rows before destinations: 0 provider, 1 provider key.
    pub(crate) selected: usize,
}

impl App {
    pub(super) fn handle_settings_key(&mut self, key: KeyEvent) {
        let total_rows = 2 + self.settings.destinations.len();
        match key.code {
            KeyCode::Char('j') | KeyCode::Down => {
                self.settings.selected =
                    (self.settings.selected + 1).min(total_rows.saturating_sub(1));
            }
            KeyCode::Char('k') | KeyCode::Up => {
                self.settings.selected = self.settings.selected.saturating_sub(1);
            }
            KeyCode::Enter => {
                self.settings_activate();
            }
            KeyCode::Char('a') => {
                self.dialog = Some(Dialog::Form(Form::add_destination()));
            }
            KeyCode::Char('m') => {
                let Some(settings) = self.settings.settings.clone() else {
                    return;
                };
                if settings.provider == "fake" {
                    self.set_notice(
                        "The fake provider hook does not use a configurable model",
                        true,
                    );
                    return;
                }
                let current_model = settings
                    .model
                    .as_deref()
                    .map(str::trim)
                    .filter(|m| !m.is_empty())
                    .unwrap_or("");
                self.dialog = Some(Dialog::Form(Form::edit_model(
                    &settings.provider,
                    current_model,
                )));
            }
            KeyCode::Char('x') if self.settings.selected == 1 => {
                let Some(settings) = self.settings.settings.clone() else {
                    return;
                };
                if settings.provider == "fake" || !settings.hasProviderKey {
                    return;
                }
                self.dialog = Some(Dialog::Confirm {
                    title: "Remove provider key".into(),
                    message: format!(
                        "Remove the stored key for {}? Tasks fail until a key is set again.",
                        settings.provider
                    ),
                    action: ConfirmAction::RemoveProviderKey {
                        provider: settings.provider.clone(),
                    },
                });
            }
            KeyCode::Char('x') if self.settings.selected >= 2 => {
                let index = self.settings.selected - 2;
                if let Some(destination) = self.settings.destinations.get(index) {
                    self.dialog = Some(Dialog::Confirm {
                        title: "Remove export destination".into(),
                        message: format!("Remove {} as an export destination?", destination.path),
                        action: ConfirmAction::RemoveDestination {
                            destination_id: destination.id.clone(),
                        },
                    });
                }
            }
            _ => {}
        }
    }

    fn settings_activate(&mut self) {
        match self.settings.selected {
            0 => {
                let Some(settings) = self.settings.settings.clone() else {
                    return;
                };
                let order = ["openai", "gemini", "openrouter", "tokenfactory"];
                let current = order
                    .iter()
                    .position(|provider| *provider == settings.provider);
                let next = match current {
                    Some(index) => (index + 1) % order.len(),
                    None => 0,
                };
                let provider = order[next].to_string();
                let input = SetProviderConfigRequest {
                    provider: provider.clone(),
                    model: None,
                };
                let api = self.api.clone();
                self.spawn_mutation(format!("Provider switched to {provider}"), async move {
                    api.set_provider(&input).await
                });
            }
            1 => {
                let Some(settings) = self.settings.settings.clone() else {
                    return;
                };
                if settings.provider == "fake" {
                    self.set_notice("The fake provider hook does not take a key", true);
                    return;
                }
                self.dialog = Some(Dialog::Form(Form::set_provider_key(
                    &settings.provider,
                    settings.hasProviderKey,
                )));
            }
            _ => {}
        }
    }
}
