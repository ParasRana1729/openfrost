//! Modal form dialogs: field navigation, masked inputs, and submit routing.
//! Every form maps to exactly one API call in `App::submit_form`.

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use tui_textarea::TextArea;

use crate::app::FormKind;
use crate::contracts::Project;

pub struct Form {
    pub title: String,
    pub fields: Vec<Field>,
    pub focus: usize,
    pub kind: FormKind,
    pub error: Option<String>,
}

// TextArea is a large value; boxing it would churn every edit site for no
// practical gain in a modal that holds a handful of fields.
#[allow(clippy::large_enum_variant)]
pub enum Field {
    Text {
        label: String,
        area: TextArea<'static>,
        masked: bool,
        hint: Option<String>,
    },
    Select {
        label: String,
        options: Vec<String>,
        selected: usize,
    },
}

impl Field {
    pub fn value(&self) -> String {
        match self {
            Field::Text { area, .. } => area.lines().join("\n"),
            Field::Select {
                options, selected, ..
            } => options.get(*selected).cloned().unwrap_or_default(),
        }
    }
}

impl Form {
    fn new(title: impl Into<String>, fields: Vec<Field>, kind: FormKind) -> Self {
        Self {
            title: title.into(),
            fields,
            focus: 0,
            kind,
            error: None,
        }
    }

    fn text(label: impl Into<String>, value: &str, masked: bool, hint: Option<&str>) -> Field {
        let mut area = if value.is_empty() {
            TextArea::default()
        } else {
            TextArea::new(value.lines().map(str::to_string).collect::<Vec<_>>())
        };
        if masked {
            area.set_mask_char('\u{2022}');
        }
        Field::Text {
            label: label.into(),
            area,
            masked,
            hint: hint.map(str::to_string),
        }
    }

    fn select(label: impl Into<String>, options: Vec<String>, selected: usize) -> Field {
        Field::Select {
            label: label.into(),
            options,
            selected,
        }
    }

    pub fn create_project() -> Self {
        Self::new(
            "New project",
            vec![
                Self::text("Name", "", false, Some("required")),
                Self::text(
                    "Instructions",
                    "",
                    false,
                    Some("standing context for scoped tasks"),
                ),
            ],
            FormKind::CreateProject,
        )
    }

    pub fn edit_project(project: &Project) -> Self {
        let grants_note = format!(
            "{} folder grant(s) managed on the project screen",
            project.grants.len()
        );
        Self::new(
            format!("Edit project \u{2014} {}", project.name),
            vec![
                Self::text("Name", &project.name, false, Some("required")),
                Self::text(
                    "Instructions",
                    project.instructions.as_deref().unwrap_or(""),
                    false,
                    Some(grants_note.as_str()),
                ),
            ],
            FormKind::EditProject {
                project_id: project.id.clone(),
            },
        )
    }

    pub fn grant_folder(project_id: String) -> Self {
        Self::new(
            "Grant source folder",
            vec![Self::text(
                "Folder path",
                "",
                false,
                Some("absolute path; access is checked against the canonical root"),
            )],
            FormKind::GrantFolder { project_id },
        )
    }

    pub fn add_destination() -> Self {
        Self::new(
            "Add export destination",
            vec![Self::text(
                "Folder path",
                "",
                false,
                Some("absolute path; exports may only create new files inside"),
            )],
            FormKind::AddDestination,
        )
    }

    pub fn set_provider_key(provider: &str, has_existing_key: bool) -> Self {
        let hint = if has_existing_key {
            "replaces existing key; min 10 chars, stored with Windows DPAPI"
        } else {
            "min 10 chars, stored with Windows DPAPI; never displayed again"
        };
        Self::new(
            format!("Set provider key \u{2014} {provider}"),
            vec![Self::text("API key", "", true, Some(hint))],
            FormKind::SetProviderKey {
                provider: provider.to_string(),
            },
        )
    }

    /// Destination options are filled in when the destinations payload lands.
    pub fn export(artifact_id: String) -> Self {
        Self::new(
            "Export report",
            vec![
                Self::select(
                    "Destination",
                    vec!["(loading destinations\u{2026})".to_string()],
                    0,
                ),
                Self::text(
                    "Filename",
                    "",
                    false,
                    Some("must end in .md; a new file is created, never overwritten"),
                ),
            ],
            FormKind::Export { artifact_id },
        )
    }

    pub fn create_routine() -> Self {
        Self::new(
            "New weekly-planning routine",
            vec![
                Self::text("Name", "", false, Some("required")),
                Self::select("Project", vec!["(loading projects\u{2026})".to_string()], 0),
                Self::text("Time zone", "", false, Some("IANA name, e.g. Asia/Kolkata")),
                Self::select("Cadence", vec!["weekly".into(), "daily".into()], 0),
                Self::select(
                    "Weekday",
                    [
                        "Sunday",
                        "Monday",
                        "Tuesday",
                        "Wednesday",
                        "Thursday",
                        "Friday",
                        "Saturday",
                    ]
                    .iter()
                    .map(|day| day.to_string())
                    .collect(),
                    5,
                ),
                Self::text("Time", "", false, Some("HH:mm, 24h, local to the zone")),
                Self::text("Task title", "", false, Some("required")),
                Self::text("Request", "", false, Some("what the routine asks for")),
            ],
            FormKind::CreateRoutine,
        )
    }

    /// Same field layout as creation, prefilled from the routine.
    pub fn edit_routine(routine: &crate::contracts::Routine) -> Self {
        let (cadence, weekday) = match &routine.schedule {
            crate::contracts::RoutineSchedule::Weekly { weekday, .. } => {
                (0usize, *weekday as usize)
            }
            crate::contracts::RoutineSchedule::Daily { .. } => (1usize, 5usize),
        };
        let time = match &routine.schedule {
            crate::contracts::RoutineSchedule::Weekly { time, .. } => time.clone(),
            crate::contracts::RoutineSchedule::Daily { time } => time.clone(),
        };
        Self::new(
            format!("Edit routine \u{2014} {}", routine.name),
            vec![
                Self::text("Name", &routine.name, false, Some("required")),
                Self::select("Project", vec!["(loading projects\u{2026})".to_string()], 0),
                Self::text(
                    "Time zone",
                    &routine.timezone,
                    false,
                    Some("IANA name, e.g. Asia/Kolkata"),
                ),
                Self::select("Cadence", vec!["weekly".into(), "daily".into()], cadence),
                Self::select(
                    "Weekday",
                    [
                        "Sunday",
                        "Monday",
                        "Tuesday",
                        "Wednesday",
                        "Thursday",
                        "Friday",
                        "Saturday",
                    ]
                    .iter()
                    .map(|day| day.to_string())
                    .collect(),
                    weekday,
                ),
                Self::text("Time", &time, false, Some("HH:mm, 24h, local to the zone")),
                Self::text(
                    "Task title",
                    &routine.template.title,
                    false,
                    Some("required"),
                ),
                Self::text(
                    "Request",
                    &routine.template.request,
                    false,
                    Some("what the routine asks for"),
                ),
            ],
            FormKind::EditRoutine {
                routine_id: routine.id.clone(),
            },
        )
    }

    pub fn edit_memory_entry(entry_id: &str, file_sha: &str, content: &str) -> Self {
        Self::new(
            "Edit memory entry",
            vec![Self::text("Content", content, false, None)],
            FormKind::EditMemoryEntry {
                entry_id: entry_id.to_string(),
                file_sha: file_sha.to_string(),
            },
        )
    }

    /// Returns true while the dialog stays open; false means the dialog
    /// closes (Esc discards, Ctrl+S submits — the caller decides by checking
    /// `error`/return of `App::submit_form`).
    pub fn handle_key(&mut self, key: KeyEvent) -> bool {
        if key.code == KeyCode::Esc {
            return false;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('s') {
            return false; // submit
        }
        match key.code {
            KeyCode::Tab => {
                self.focus = (self.focus + 1) % self.fields.len();
            }
            KeyCode::BackTab => {
                self.focus = (self.focus + self.fields.len() - 1) % self.fields.len();
            }
            _ => match &mut self.fields[self.focus] {
                Field::Text { area, .. } => {
                    let _ = area.input(key);
                }
                Field::Select {
                    options, selected, ..
                } => match key.code {
                    KeyCode::Right | KeyCode::Char('l') | KeyCode::Down => {
                        if !options.is_empty() {
                            *selected = (*selected + 1) % options.len();
                        }
                    }
                    KeyCode::Left | KeyCode::Char('h') | KeyCode::Up => {
                        if !options.is_empty() {
                            *selected = (*selected + options.len() - 1) % options.len();
                        }
                    }
                    KeyCode::Enter => {
                        self.focus = (self.focus + 1) % self.fields.len();
                    }
                    _ => {}
                },
            },
        }
        true
    }

    pub fn values(&self) -> Vec<String> {
        self.fields.iter().map(Field::value).collect()
    }

    pub fn select_index(&self, field: usize) -> usize {
        match &self.fields[field] {
            Field::Select { selected, .. } => *selected,
            _ => 0,
        }
    }

    /// Replace a select's options (used when destinations/projects arrive).
    pub fn set_options(&mut self, field: usize, options: Vec<String>) {
        if let Field::Select {
            options: slot,
            selected,
            ..
        } = &mut self.fields[field]
        {
            *slot = options;
            *selected = 0;
        }
    }
}

/// Formats a masked input value for display in form dialogs.
///
/// An empty input returns `""` so the focused cursor `_` indicates an empty field.
/// Short inputs (up to 4 chars) show the typed characters (e.g. `sk-o`) so the user
/// has immediate feedback that keystrokes or paste are registering.
/// Longer inputs keep the first 4 characters visible, mask subsequent characters
/// with bullets, and display the character count (e.g. `sk-o•••••••••••••••• (36 chars)`).
pub fn format_masked_input(value: &str) -> String {
    let first_line = value.lines().next().unwrap_or("");
    let chars: Vec<char> = first_line.chars().collect();
    let count = chars.len();
    if count == 0 {
        String::new()
    } else if count <= 4 {
        chars.into_iter().collect()
    } else {
        let prefix: String = chars[..4].iter().collect();
        let bullets = "\u{2022}".repeat((count - 4).min(16));
        format!("{prefix}{bullets} ({count} chars)")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masked_input_empty_returns_empty() {
        assert_eq!(format_masked_input(""), "");
    }

    #[test]
    fn masked_input_short_shows_chars() {
        assert_eq!(format_masked_input("s"), "s");
        assert_eq!(format_masked_input("sk"), "sk");
        assert_eq!(format_masked_input("sk-"), "sk-");
        assert_eq!(format_masked_input("sk-o"), "sk-o");
    }

    #[test]
    fn masked_input_long_masks_and_shows_count() {
        assert_eq!(format_masked_input("sk-or"), "sk-o\u{2022} (5 chars)");
        assert_eq!(
            format_masked_input("sk-or-v1-abcdef1234567890"),
            format!("sk-o{} (25 chars)", "\u{2022}".repeat(16))
        );
    }

    #[test]
    fn set_provider_key_hint_reflects_existing_state() {
        let form_fresh = Form::set_provider_key("openrouter", false);
        match &form_fresh.fields[0] {
            Field::Text { hint, .. } => {
                assert!(hint.as_deref().unwrap().contains("never displayed again"));
            }
            _ => panic!("expected Field::Text"),
        }

        let form_existing = Form::set_provider_key("openrouter", true);
        match &form_existing.fields[0] {
            Field::Text { hint, .. } => {
                assert!(hint.as_deref().unwrap().contains("replaces existing key"));
            }
            _ => panic!("expected Field::Text"),
        }
    }
}
