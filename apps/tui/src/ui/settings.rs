use super::{accent, block, muted};
use crate::app::App;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Paragraph, Wrap};
use ratatui::Frame;

pub(super) fn render_settings(app: &mut App, frame: &mut Frame, area: Rect) {
    let mut lines: Vec<Line> = Vec::new();
    let selected = app.settings.selected;

    let settings = app.settings.settings.as_ref();
    let provider = settings.map(|s| s.provider.clone()).unwrap_or_default();
    let model = settings
        .and_then(|s| s.model.clone())
        .unwrap_or_else(|| "\u{2014}".to_string());
    let has_key = settings.map(|s| s.hasProviderKey).unwrap_or(false);

    lines.push(row_line(
        0 == selected,
        "Provider",
        &format!("{provider}  (model: {model})"),
    ));
    lines.push(Line::styled(
        "     Enter/l to cycle openai \u{2192} gemini \u{2192} openrouter".to_string(),
        muted(),
    ));
    lines.push(row_line(
        1 == selected,
        "Provider key",
        &if has_key {
            "configured (stored with Windows DPAPI)".to_string()
        } else {
            "not set".to_string()
        },
    ));
    lines.push(Line::styled(
        "     Enter to set a key (masked input); the key is never shown again".to_string(),
        muted(),
    ));
    lines.push(Line::from(""));

    lines.push(Line::styled(
        "Export destinations",
        accent().add_modifier(Modifier::BOLD),
    ));
    for (index, destination) in app.settings.destinations.iter().enumerate() {
        let row = 2 + index;
        let marker = if row == selected { " > " } else { "   " };
        lines.push(Line::from(vec![
            Span::raw(marker),
            Span::raw(destination.path.clone()),
            Span::styled("  (x remove)", muted()),
        ]));
    }
    if app.settings.destinations.is_empty() {
        lines.push(Line::styled(
            "   (none \u{2014} press a to add a folder exports may write into)".to_string(),
            muted(),
        ));
    }
    lines.push(Line::from(""));
    lines.push(Line::styled(
        " j/k move | Enter activate | a add destination | x remove destination".to_string(),
        muted(),
    ));
    frame.render_widget(
        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .block(block("Settings")),
        area,
    );
}

fn row_line(active: bool, label: &str, value: &str) -> Line<'static> {
    Line::from(vec![
        Span::raw(if active { " > " } else { "   " }),
        Span::styled(
            format!("{label}: "),
            if active {
                accent().add_modifier(Modifier::BOLD)
            } else {
                Style::default().add_modifier(Modifier::BOLD)
            },
        ),
        Span::raw(value.to_string()),
    ])
}

// ---------------------------------------------------------------------------
// Tab picker (Ctrl+P)
// ---------------------------------------------------------------------------
