//! Cohesive "Glacier Ink" visual theme inspired by Claude Code & Codex CLI.
//!
//! Uses a restrained glacier-blue accent palette paired with quiet dark-slate
//! chrome and desaturated semantic colors so content stays crisp and scannable.

use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders};

// ---------------------------------------------------------------------------
// Palette (Glacier Ink)
// ---------------------------------------------------------------------------

pub(crate) const FROST_GLOW: Color = Color::Rgb(230, 237, 245);
pub(crate) const ICE_BRIGHT: Color = Color::Rgb(124, 196, 250);
pub(crate) const ICE_MID: Color = Color::Rgb(75, 156, 211);
pub(crate) const ICE_DIM: Color = Color::Rgb(105, 128, 152);

pub(crate) const SLATE_BORDER: Color = Color::Rgb(44, 54, 70);
pub(crate) const MUTED: Color = Color::Rgb(107, 122, 140);
pub(crate) const SURFACE_SEL: Color = Color::Rgb(29, 37, 50);
pub(crate) const SURFACE_PILL: Color = Color::Rgb(20, 25, 34);

pub(crate) const EMERALD: Color = Color::Rgb(94, 194, 154);
pub(crate) const ROSE: Color = Color::Rgb(229, 115, 115);
pub(crate) const AMBER: Color = Color::Rgb(224, 175, 104);
pub(crate) const VIOLET: Color = Color::Rgb(179, 157, 219);

// ---------------------------------------------------------------------------
// Common styles
// ---------------------------------------------------------------------------

pub(crate) fn accent() -> Style {
    Style::default().fg(ICE_BRIGHT)
}

pub(crate) fn accent_bold() -> Style {
    Style::default().fg(ICE_BRIGHT).add_modifier(Modifier::BOLD)
}

pub(crate) fn ice_mid() -> Style {
    Style::default().fg(ICE_MID)
}

pub(crate) fn frost_glow() -> Style {
    Style::default().fg(FROST_GLOW)
}

pub(crate) fn muted() -> Style {
    Style::default().fg(MUTED)
}

pub(crate) fn hairline_style() -> Style {
    Style::default().fg(SLATE_BORDER)
}

pub(crate) fn primary_bold() -> Style {
    Style::default().fg(FROST_GLOW).add_modifier(Modifier::BOLD)
}

pub(crate) fn selected_style() -> Style {
    Style::default()
        .bg(SURFACE_SEL)
        .fg(FROST_GLOW)
        .add_modifier(Modifier::BOLD)
}

pub(crate) fn pill(fg: Color, bg: Color) -> Style {
    Style::default().fg(fg).bg(bg)
}

pub(crate) fn success() -> Style {
    Style::default().fg(EMERALD)
}

pub(crate) fn warn() -> Style {
    Style::default().fg(AMBER)
}

pub(crate) fn danger() -> Style {
    Style::default().fg(ROSE)
}

pub(crate) fn approval() -> Style {
    Style::default().fg(VIOLET)
}

// ---------------------------------------------------------------------------
// Reusable chrome builders
// ---------------------------------------------------------------------------

pub(crate) fn rounded_block(title: &str) -> Block<'static> {
    rounded_block_focused(title, true)
}

pub(crate) fn rounded_block_focused(title: &str, focused: bool) -> Block<'static> {
    let border_style = if focused {
        Style::default().fg(ICE_MID)
    } else {
        Style::default().fg(SLATE_BORDER)
    };
    let title_style = if focused {
        frost_glow().add_modifier(Modifier::BOLD)
    } else {
        muted()
    };
    Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(border_style)
        .title(Span::styled(format!(" {title} "), title_style))
}

pub(crate) fn hairline(width: u16) -> Line<'static> {
    let count = width as usize;
    Line::styled("─".repeat(count), hairline_style())
}

pub(crate) fn section_rule(label: &str, width: u16) -> Line<'static> {
    let prefix = format!("  ── {label} ");
    let used = prefix.chars().count();
    let total = (width as usize).saturating_sub(2);
    let fill = total.saturating_sub(used);
    Line::from(vec![
        Span::styled("  ── ", hairline_style()),
        Span::styled(
            label.to_string(),
            Style::default().fg(ICE_DIM).add_modifier(Modifier::BOLD),
        ),
        Span::styled(" ", hairline_style()),
        Span::styled("─".repeat(fill), hairline_style()),
    ])
}
