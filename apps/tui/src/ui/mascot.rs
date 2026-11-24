//! Frost Owl mascot and lightweight tick-driven terminal animations.
//!
//! All art uses strictly single-width Unicode block/box glyphs so alignment
//! stays pixel-sharp across Windows Terminal, Alacritty, WezTerm, and macOS/Linux
//! terminals without emoji-width drift.

use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use super::theme::{
    accent_bold, frost_glow, hairline_style, ice_mid, muted, AMBER, FROST_GLOW, ICE_BRIGHT,
    ICE_DIM, ICE_MID, SLATE_BORDER,
};

const FROST_SPINNER: &[&str] = &["✶", "✸", "✹", "✺", "✹", "✸", "✦", "✧"];
const BRAILLE_SPINNER: &[&str] = &["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

pub(super) fn frost_spinner(ticks: u64) -> &'static str {
    FROST_SPINNER[((ticks / 2) as usize) % FROST_SPINNER.len()]
}

pub(super) fn braille_spinner(ticks: u64) -> &'static str {
    BRAILLE_SPINNER[(ticks as usize) % BRAILLE_SPINNER.len()]
}

/// Compact inline owl badge for running states and status indicators.
pub(super) fn mini_owl_spans(ticks: u64, active: bool) -> Vec<Span<'static>> {
    let (eyes, eye_color) = if !active {
        ("●", ICE_BRIGHT)
    } else {
        match (ticks / 3) % 14 {
            13 => ("─", ICE_DIM),
            6 | 7 => ("✦", FROST_GLOW),
            _ => ("●", ICE_BRIGHT),
        }
    };
    vec![
        Span::styled("⟨", Style::default().fg(ICE_DIM)),
        Span::styled(eyes, Style::default().fg(eye_color)),
        Span::styled("▾", Style::default().fg(AMBER)),
        Span::styled(eyes, Style::default().fg(eye_color)),
        Span::styled("⟩", Style::default().fg(ICE_DIM)),
    ]
}

/// Large animated Frost Owl (8 lines × 17 columns) for the Connecting screen.
pub(super) fn splash_owl_lines(ticks: u64, has_error: bool) -> Vec<Line<'static>> {
    let phase = ticks % 48;
    let is_blink = matches!(phase, 44..=46);
    let is_glint = !has_error && matches!(phase, 20..=22);

    let (left_eye, right_eye, eye_style) = if has_error {
        (
            " × ",
            " × ",
            Style::default().fg(AMBER).add_modifier(Modifier::BOLD),
        )
    } else if is_blink {
        (" ─ ", " ─ ", Style::default().fg(ICE_DIM))
    } else if is_glint {
        (
            " ✦ ",
            " ✦ ",
            Style::default().fg(FROST_GLOW).add_modifier(Modifier::BOLD),
        )
    } else {
        match (ticks / 10) % 4 {
            1 => (
                "●  ",
                "●  ",
                Style::default().fg(ICE_BRIGHT).add_modifier(Modifier::BOLD),
            ),
            3 => (
                "  ●",
                "  ●",
                Style::default().fg(ICE_BRIGHT).add_modifier(Modifier::BOLD),
            ),
            _ => (
                " ● ",
                " ● ",
                Style::default().fg(ICE_BRIGHT).add_modifier(Modifier::BOLD),
            ),
        }
    };

    let chest_pulse = (ticks / 4) % 3;
    let (c1, c2, c3) = match chest_pulse {
        0 => (ICE_BRIGHT, FROST_GLOW, ICE_DIM),
        1 => (ICE_DIM, ICE_BRIGHT, FROST_GLOW),
        _ => (FROST_GLOW, ICE_DIM, ICE_BRIGHT),
    };

    let wing = Style::default().fg(ICE_MID);
    let crown = Style::default().fg(ICE_BRIGHT);
    let rim = Style::default().fg(FROST_GLOW);
    let beak = Style::default().fg(AMBER).add_modifier(Modifier::BOLD);
    let feet = Style::default().fg(AMBER);

    vec![
        Line::from(vec![
            Span::raw("  "),
            Span::styled("▄▀▄", crown),
            Span::raw("       "),
            Span::styled("▄▀▄", crown),
            Span::raw("  "),
        ]),
        Line::from(vec![
            Span::raw(" "),
            Span::styled("▄█████████████▄", wing),
            Span::raw(" "),
        ]),
        Line::from(vec![
            Span::styled("██", wing),
            Span::raw(" "),
            Span::styled("╭───╮", rim),
            Span::raw(" "),
            Span::styled("╭───╮", rim),
            Span::raw(" "),
            Span::styled("██", wing),
        ]),
        Line::from(vec![
            Span::styled("██", wing),
            Span::raw(" "),
            Span::styled("│", rim),
            Span::styled(left_eye, eye_style),
            Span::styled("│", rim),
            Span::raw(" "),
            Span::styled("│", rim),
            Span::styled(right_eye, eye_style),
            Span::styled("│", rim),
            Span::raw(" "),
            Span::styled("██", wing),
        ]),
        Line::from(vec![
            Span::styled("██", wing),
            Span::raw(" "),
            Span::styled("╰──╮╰", rim),
            Span::styled("▾", beak),
            Span::styled("╯╭──╯", rim),
            Span::raw(" "),
            Span::styled("██", wing),
        ]),
        Line::from(vec![
            Span::raw(" "),
            Span::styled("▀██", wing),
            Span::raw("  "),
            Span::styled("✧", Style::default().fg(c1)),
            Span::raw(" "),
            Span::styled("✦", Style::default().fg(c2)),
            Span::raw(" "),
            Span::styled("✧", Style::default().fg(c3)),
            Span::raw("  "),
            Span::styled("██▀", wing),
            Span::raw(" "),
        ]),
        Line::from(vec![
            Span::raw("   "),
            Span::styled("▀█████████▀", wing),
            Span::raw("   "),
        ]),
        Line::from(vec![
            Span::styled("───", hairline_style()),
            Span::raw("  "),
            Span::styled("▄▀", feet),
            Span::raw("   "),
            Span::styled("▀▄", feet),
            Span::raw("  "),
            Span::styled("───", hairline_style()),
        ]),
    ]
}

/// Compact Frost Owl (6 lines × 15 columns) for the Assistant welcome hero card.
pub(super) fn compact_owl_lines(ticks: u64) -> Vec<Line<'static>> {
    let is_blink = (ticks % 52) >= 49;
    let (l_eye, r_eye, eye_style) = if is_blink {
        ("──", "──", Style::default().fg(ICE_DIM))
    } else {
        (
            "● ",
            " ●",
            Style::default().fg(ICE_BRIGHT).add_modifier(Modifier::BOLD),
        )
    };

    let wing = Style::default().fg(ICE_MID);
    let crown = Style::default().fg(ICE_BRIGHT);
    let rim = Style::default().fg(FROST_GLOW);
    let beak = Style::default().fg(AMBER).add_modifier(Modifier::BOLD);
    let glint = if (ticks / 6).is_multiple_of(2) {
        ICE_BRIGHT
    } else {
        FROST_GLOW
    };

    vec![
        Line::from(vec![
            Span::raw("  "),
            Span::styled("▄▀▄", crown),
            Span::raw("     "),
            Span::styled("▄▀▄", crown),
            Span::raw("  "),
        ]),
        Line::from(vec![
            Span::raw(" "),
            Span::styled("▄███████████▄", wing),
            Span::raw(" "),
        ]),
        Line::from(vec![
            Span::styled("██", wing),
            Span::raw(" "),
            Span::styled("╭──╮", rim),
            Span::raw(" "),
            Span::styled("╭──╮", rim),
            Span::raw(" "),
            Span::styled("██", wing),
        ]),
        Line::from(vec![
            Span::styled("██", wing),
            Span::raw(" "),
            Span::styled("│", rim),
            Span::styled(l_eye, eye_style),
            Span::styled("│", rim),
            Span::styled("▾", beak),
            Span::styled("│", rim),
            Span::styled(r_eye, eye_style),
            Span::styled("│", rim),
            Span::raw(" "),
            Span::styled("██", wing),
        ]),
        Line::from(vec![
            Span::raw(" "),
            Span::styled("▀██", wing),
            Span::raw(" "),
            Span::styled("✧", Style::default().fg(ICE_DIM)),
            Span::raw(" "),
            Span::styled("✦", Style::default().fg(glint)),
            Span::raw(" "),
            Span::styled("✧", Style::default().fg(ICE_DIM)),
            Span::raw(" "),
            Span::styled("██▀", wing),
            Span::raw(" "),
        ]),
        Line::from(vec![
            Span::raw("   "),
            Span::styled("▀███████▀", wing),
            Span::raw("   "),
        ]),
    ]
}

/// Shimmering `O P E N F R O S T` gradient wordmark for the Connecting screen.
pub(super) fn shimmer_wordmark(ticks: u64) -> Line<'static> {
    let letters = ['O', 'P', 'E', 'N', 'F', 'R', 'O', 'S', 'T'];
    let wave = (ticks / 2) as usize % (letters.len() + 6);
    let mut spans = Vec::with_capacity(letters.len() * 2);
    for (i, ch) in letters.iter().enumerate() {
        let dist = i.abs_diff(wave);
        let style = match dist {
            0 => frost_glow().add_modifier(Modifier::BOLD),
            1 => accent_bold(),
            2 => ice_mid().add_modifier(Modifier::BOLD),
            _ => Style::default().fg(ICE_DIM).add_modifier(Modifier::BOLD),
        };
        spans.push(Span::styled(ch.to_string(), style));
        if i + 1 < letters.len() {
            spans.push(Span::raw(" "));
        }
    }
    Line::from(spans)
}

/// Smooth bouncing frost loading bar (`━━━━━━━━`) for the Connecting screen.
pub(super) fn pulse_bar(ticks: u64, width: usize) -> Line<'static> {
    let width = width.clamp(12, 40);
    let period = width.saturating_sub(4).max(1) * 2;
    let step = (ticks as usize) % period;
    let head = if step < period / 2 {
        step
    } else {
        period - step
    };

    let mut spans = Vec::with_capacity(width);
    for col in 0..width {
        let style = if col >= head && col < head + 4 {
            if col == head + 1 || col == head + 2 {
                Style::default().fg(FROST_GLOW)
            } else {
                Style::default().fg(ICE_BRIGHT)
            }
        } else if col + 1 == head || col == head + 4 {
            Style::default().fg(ICE_DIM)
        } else {
            Style::default().fg(SLATE_BORDER)
        };
        spans.push(Span::styled("━", style));
    }
    Line::from(spans)
}

/// Renders gentle drifting frost particles around the outside of a centred card.
pub(super) fn render_frost_backdrop(frame: &mut Frame, area: Rect, exclude: Rect, ticks: u64) {
    if area.width < 24 || area.height < 12 {
        return;
    }

    let particle_count = ((area.width as usize * area.height as usize) / 140).clamp(12, 42);
    for idx in 0..particle_count {
        // Deterministic pseudo-random distribution using golden-ratio-like primes.
        let seed_x = (idx * 37 + 13) % (area.width as usize);
        let seed_y = (idx * 19 + 7) % (area.height as usize);
        let speed = if idx % 3 == 0 { 2 } else { 1 };
        let drift_y =
            ((ticks as usize / (3 + (idx % 3))) * speed + seed_y) % (area.height as usize);
        let sway_x = if (ticks as usize / 6 + idx).is_multiple_of(2) {
            seed_x
        } else {
            (seed_x + 1) % (area.width as usize)
        };

        let x = area.x + sway_x as u16;
        let y = area.y + drift_y as u16;

        // Keep the central hero card completely clean.
        let pad_x = exclude.x.saturating_sub(2);
        let pad_y = exclude.y.saturating_sub(1);
        let pad_r = exclude.x.saturating_add(exclude.width).saturating_add(2);
        let pad_b = exclude.y.saturating_add(exclude.height).saturating_add(1);
        if x >= pad_x && x < pad_r && y >= pad_y && y < pad_b {
            continue;
        }

        let (glyph, style) = match idx % 5 {
            0 => ("✦", Style::default().fg(ICE_DIM)),
            1 => ("✧", Style::default().fg(SLATE_BORDER)),
            2 => ("·", muted()),
            3 => ("◦", Style::default().fg(SLATE_BORDER)),
            _ => ("·", Style::default().fg(ICE_DIM)),
        };

        let cell = Rect {
            x,
            y,
            width: 1,
            height: 1,
        };
        frame.render_widget(Paragraph::new(Span::styled(glyph, style)), cell);
    }
}
