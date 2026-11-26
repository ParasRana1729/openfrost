use super::tasks::keybind_footer;
use super::theme::{
    accent_bold, frost_glow, ice_mid, muted, pill, rounded_block, section_rule, selected_style,
    AMBER, EMERALD, ICE_DIM, SURFACE_SEL,
};
use crate::app::App;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Paragraph, Wrap};
use ratatui::Frame;

pub(super) fn render_settings(app: &mut App, frame: &mut Frame, area: Rect) {
    let vertical = Layout::vertical([Constraint::Min(2), Constraint::Length(1)]).split(area);
    let (content_area, footer_area) = (vertical[0], vertical[1]);
    let inner_w = content_area.width.saturating_sub(2);

    let mut lines: Vec<Line> = Vec::new();
    let selected = app.settings.selected;

    let settings = app.settings.settings.as_ref();
    let provider = settings
        .map(|s| s.provider.clone())
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| "—".to_string());
    let model = match settings {
        Some(s) => s
            .model
            .as_deref()
            .map(str::trim)
            .filter(|m| !m.is_empty())
            .unwrap_or("default")
            .to_string(),
        None => "—".to_string(),
    };
    let has_key = settings.map(|s| s.hasProviderKey).unwrap_or(false);

    lines.push(section_rule("Model & Provider", inner_w));

    let provider_sel = selected == 0;
    let provider_line = Line::from(vec![
        Span::styled(
            if provider_sel { " ▸ " } else { "   " },
            if provider_sel { accent_bold() } else { muted() },
        ),
        Span::styled(
            format!("{:<14}", "Provider"),
            if provider_sel { accent_bold() } else { muted() },
        ),
        Span::styled(provider, frost_glow().add_modifier(Modifier::BOLD)),
        Span::styled("  ·  model: ", muted()),
        Span::styled(
            model.clone(),
            if model == "—" || model == "default" {
                muted()
            } else {
                ice_mid()
            },
        ),
    ]);
    lines.push(if provider_sel {
        provider_line.style(selected_style())
    } else {
        provider_line
    });
    lines.push(Line::styled(
        "     Enter to cycle openai → gemini → openrouter → tokenfactory · m to edit model",
        Style::default().fg(ICE_DIM),
    ));
    lines.push(Line::from(""));

    let key_sel = selected == 1;
    let key_badge = if has_key {
        Span::styled(" configured ", pill(EMERALD, SURFACE_SEL))
    } else {
        Span::styled(" not set ", pill(AMBER, SURFACE_SEL))
    };
    let key_note = if has_key {
        Span::styled("  stored with Windows DPAPI", muted())
    } else {
        Span::styled("  required before running tasks", muted())
    };
    let key_line = Line::from(vec![
        Span::styled(
            if key_sel { " ▸ " } else { "   " },
            if key_sel { accent_bold() } else { muted() },
        ),
        Span::styled(
            format!("{:<14}", "Provider key"),
            if key_sel { accent_bold() } else { muted() },
        ),
        key_badge,
        key_note,
    ]);
    lines.push(if key_sel {
        key_line.style(selected_style())
    } else {
        key_line
    });
    lines.push(Line::styled(
        "     Enter to set key (masked) · x to remove stored key",
        Style::default().fg(ICE_DIM),
    ));
    lines.push(Line::from(""));

    lines.push(section_rule("Export destinations", inner_w));
    for (index, destination) in app.settings.destinations.iter().enumerate() {
        let row = 2 + index;
        let is_sel = row == selected;
        let marker = if is_sel { " ▸ " } else { "   " };
        let mut spans = vec![
            Span::styled(marker, if is_sel { accent_bold() } else { muted() }),
            Span::styled(destination.path.clone(), frost_glow()),
        ];
        if is_sel {
            spans.push(Span::styled("  (x remove)", Style::default().fg(ICE_DIM)));
        }
        let line = Line::from(spans);
        lines.push(if is_sel {
            line.style(selected_style())
        } else {
            line
        });
    }
    if app.settings.destinations.is_empty() {
        lines.push(Line::styled(
            "   No export destinations yet — press a to allow a folder for exports.",
            muted(),
        ));
    }

    frame.render_widget(
        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .block(rounded_block("Settings")),
        content_area,
    );
    frame.render_widget(
        keybind_footer(&[
            ("j/k", "move"),
            ("Enter", "activate"),
            ("m", "edit model"),
            ("a", "add destination"),
            ("x", "remove"),
        ]),
        footer_area,
    );
}
