use super::theme::{accent_bold, frost_glow, muted, rounded_block, success, warn};
use crate::app::App;
use ratatui::layout::Rect;
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
        .unwrap_or_else(|| "—".to_string());
    let has_key = settings.map(|s| s.hasProviderKey).unwrap_or(false);

    lines.push(row_line(
        0 == selected,
        "Provider",
        &format!("{provider}  (model: {model})"),
        warn(),
    ));
    lines.push(Line::styled(
        "     Enter/l to cycle openai → gemini → openrouter".to_string(),
        muted(),
    ));
    lines.push(row_line(
        1 == selected,
        "Provider key",
        if has_key {
            "configured (stored with Windows DPAPI)"
        } else {
            "not set"
        },
        if has_key { success() } else { warn() },
    ));
    lines.push(Line::styled(
        "     Enter to set a key (masked input); the key is never shown again".to_string(),
        muted(),
    ));
    lines.push(Line::from(""));

    lines.push(Line::styled(" Export destinations", accent_bold()));
    for (index, destination) in app.settings.destinations.iter().enumerate() {
        let row = 2 + index;
        let is_sel = row == selected;
        let marker = if is_sel { " ▸ " } else { "   " };
        lines.push(Line::from(vec![
            Span::styled(marker, if is_sel { accent_bold() } else { muted() }),
            Span::styled(destination.path.clone(), frost_glow()),
            Span::styled("  (x remove)", muted()),
        ]));
    }
    if app.settings.destinations.is_empty() {
        lines.push(Line::styled(
            "   (none — press a to add a folder exports may write into)".to_string(),
            muted(),
        ));
    }
    lines.push(Line::from(""));
    lines.push(Line::styled(
        " j/k move • Enter activate • a add destination • x remove destination".to_string(),
        muted(),
    ));
    frame.render_widget(
        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .block(rounded_block("Settings")),
        area,
    );
}

fn row_line(
    active: bool,
    label: &str,
    value: &str,
    value_style: ratatui::style::Style,
) -> Line<'static> {
    Line::from(vec![
        Span::styled(
            if active { " ▸ " } else { "   " },
            if active { accent_bold() } else { muted() },
        ),
        Span::styled(
            format!("{label}: "),
            if active { accent_bold() } else { frost_glow() },
        ),
        Span::styled(value.to_string(), value_style),
    ])
}
