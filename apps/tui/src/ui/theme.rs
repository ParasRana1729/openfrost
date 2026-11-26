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

pub(crate) fn display_width(s: &str) -> usize {
    if s.is_ascii() {
        s.bytes().filter(|&b| !b.is_ascii_control()).count()
    } else {
        Span::raw(s).width()
    }
}

pub(crate) fn char_display_width(ch: char) -> usize {
    if ch.is_ascii() {
        usize::from(!ch.is_ascii_control())
    } else {
        let mut buf = [0u8; 4];
        let s: &str = ch.encode_utf8(&mut buf);
        Span::raw(s).width()
    }
}

pub(crate) fn spans_display_width(spans: &[Span<'_>]) -> usize {
    spans.iter().map(Span::width).sum()
}

pub(crate) fn truncate_display_width(text: &str, max_width: usize) -> String {
    if display_width(text) <= max_width {
        return text.to_string();
    }
    if max_width == 0 {
        return String::new();
    }
    let target = max_width.saturating_sub(1);
    let mut out = String::new();
    let mut width = 0usize;
    for ch in text.chars() {
        let cw = char_display_width(ch);
        if width + cw > target {
            break;
        }
        out.push(ch);
        width += cw;
    }
    out.push('…');
    out
}

pub(crate) fn wrap_text_lines(text: &str, max_width: usize) -> Vec<String> {
    let width = max_width.max(1);
    let mut out = Vec::new();
    for raw_line in text.split('\n') {
        let raw_line = raw_line.strip_suffix('\r').unwrap_or(raw_line);
        if raw_line.is_empty() {
            out.push(String::new());
            continue;
        }
        let mut current = String::new();
        let mut current_w = 0usize;
        for word in raw_line.split_inclusive(' ') {
            let w_width = display_width(word);
            if current_w > 0 && current_w + w_width > width {
                out.push(current.trim_end().to_string());
                current.clear();
                current_w = 0;
            }
            if display_width(word.trim_end()) > width && current_w == 0 {
                for ch in word.chars() {
                    let cw = char_display_width(ch);
                    if current_w > 0 && current_w + cw > width {
                        out.push(std::mem::take(&mut current));
                        current_w = 0;
                    }
                    current.push(ch);
                    current_w += cw;
                }
            } else {
                let piece = if current_w == 0 {
                    word.trim_start()
                } else {
                    word
                };
                current.push_str(piece);
                current_w += display_width(piece);
            }
        }
        if !current.is_empty() {
            out.push(current.trim_end().to_string());
        }
    }
    if out.is_empty() {
        out.push(String::new());
    }
    out
}

#[derive(Clone)]
struct WrapSeg {
    text: String,
    style: Style,
}

enum WrapTok {
    Ws(Vec<WrapSeg>),
    Word(Vec<WrapSeg>),
    Newline,
}

fn push_wrap_seg(segs: &mut Vec<WrapSeg>, text: &str, style: Style) {
    if text.is_empty() {
        return;
    }
    if let Some(last) = segs.last_mut() {
        if last.style == style {
            last.text.push_str(text);
            return;
        }
    }
    segs.push(WrapSeg {
        text: text.to_string(),
        style,
    });
}

fn wrap_segs_width(segs: &[WrapSeg]) -> usize {
    segs.iter().map(|s| display_width(&s.text)).sum()
}

fn tokenize_wrap_spans(spans: &[Span<'static>]) -> Vec<WrapTok> {
    let mut tokens: Vec<WrapTok> = Vec::new();
    let mut cur_is_ws: Option<bool> = None;
    let mut cur_segs: Vec<WrapSeg> = Vec::new();

    let flush = |is_ws: Option<bool>, segs: &mut Vec<WrapSeg>, out: &mut Vec<WrapTok>| {
        if segs.is_empty() {
            return;
        }
        let taken = std::mem::take(segs);
        match is_ws {
            Some(true) => out.push(WrapTok::Ws(taken)),
            _ => out.push(WrapTok::Word(taken)),
        }
    };

    for span in spans {
        let mut run = String::new();
        let mut run_ws: Option<bool> = None;
        for ch in span.content.chars() {
            if ch == '\r' {
                continue;
            }
            if ch == '\n' {
                if !run.is_empty() {
                    if cur_is_ws != run_ws {
                        flush(cur_is_ws, &mut cur_segs, &mut tokens);
                        cur_is_ws = run_ws;
                    }
                    push_wrap_seg(&mut cur_segs, &run, span.style);
                    run.clear();
                }
                flush(cur_is_ws, &mut cur_segs, &mut tokens);
                cur_is_ws = None;
                run_ws = None;
                tokens.push(WrapTok::Newline);
                continue;
            }
            let ch_ws = ch.is_whitespace();
            if run_ws.is_some() && run_ws != Some(ch_ws) {
                if cur_is_ws != run_ws {
                    flush(cur_is_ws, &mut cur_segs, &mut tokens);
                    cur_is_ws = run_ws;
                }
                push_wrap_seg(&mut cur_segs, &run, span.style);
                run.clear();
            }
            run_ws = Some(ch_ws);
            if ch == '\t' {
                run.push_str("  ");
            } else {
                run.push(ch);
            }
        }
        if !run.is_empty() {
            if cur_is_ws != run_ws {
                flush(cur_is_ws, &mut cur_segs, &mut tokens);
                cur_is_ws = run_ws;
            }
            push_wrap_seg(&mut cur_segs, &run, span.style);
        }
    }
    flush(cur_is_ws, &mut cur_segs, &mut tokens);
    tokens
}

fn split_word_soft(word: &[WrapSeg]) -> Vec<Vec<WrapSeg>> {
    let flat: Vec<(char, Style)> = word
        .iter()
        .flat_map(|s| s.text.chars().map(move |c| (c, s.style)))
        .collect();
    let mut chunks = Vec::new();
    let mut cur = Vec::new();
    for idx in 0..flat.len() {
        let (ch, style) = flat[idx];
        let mut buf = [0u8; 4];
        push_wrap_seg(&mut cur, ch.encode_utf8(&mut buf), style);
        let next = flat.get(idx + 1).map(|(c, _)| *c);
        let is_break = matches!(
            ch,
            '/' | '\\' | '?' | '&' | '-' | '=' | '#' | ';' | ',' | '.'
        );
        let is_double_slash = ch == '/' && next == Some('/');
        if is_break && !is_double_slash && idx + 1 < flat.len() {
            chunks.push(std::mem::take(&mut cur));
        }
    }
    if !cur.is_empty() {
        chunks.push(cur);
    }
    chunks
}

fn split_segs_width(segs: &[WrapSeg], max_width: usize) -> Vec<Vec<WrapSeg>> {
    let limit = max_width.max(1);
    let mut pieces = Vec::new();
    let mut cur = Vec::new();
    let mut cur_w = 0usize;
    for seg in segs {
        for ch in seg.text.chars() {
            let cw = char_display_width(ch);
            if cur_w + cw > limit && !cur.is_empty() {
                pieces.push(std::mem::take(&mut cur));
                cur_w = 0;
            }
            let mut buf = [0u8; 4];
            push_wrap_seg(&mut cur, ch.encode_utf8(&mut buf), seg.style);
            cur_w += cw;
        }
    }
    if !cur.is_empty() {
        pieces.push(cur);
    }
    pieces
}

fn coalesce_line_spans(spans: Vec<Span<'static>>) -> Vec<Span<'static>> {
    let mut out: Vec<Span<'static>> = Vec::with_capacity(spans.len());
    for span in spans {
        if span.content.is_empty() {
            continue;
        }
        if let Some(last) = out.last_mut() {
            if last.style == span.style {
                let mut combined = last.content.to_string();
                combined.push_str(span.content.as_ref());
                last.content = combined.into();
                continue;
            }
        }
        out.push(span);
    }
    out
}

/// Wraps styled `spans` into `Line<'static>`s fitting within `max_width` display
/// columns, prepending `first_prefix` on the first line and `cont_prefix` on
/// every continuation line.
pub(crate) fn wrap_styled_spans(
    spans: &[Span<'static>],
    first_prefix: &[Span<'static>],
    cont_prefix: &[Span<'static>],
    max_width: usize,
) -> Vec<Line<'static>> {
    let budget = max_width.max(1);
    let first_prefix_w = spans_display_width(first_prefix);
    let cont_prefix_w = spans_display_width(cont_prefix);
    let first_avail = budget.saturating_sub(first_prefix_w).max(1);
    let cont_avail = budget.saturating_sub(cont_prefix_w).max(1);

    let tokens = tokenize_wrap_spans(spans);
    if tokens.is_empty() {
        return vec![Line::from(coalesce_line_spans(first_prefix.to_vec()))];
    }

    let mut out: Vec<Line<'static>> = Vec::new();
    let mut cur_line: Vec<Span<'static>> = first_prefix.to_vec();
    let mut cur_avail = first_avail;
    let mut cur_w = 0usize;
    let mut pending_ws: Option<Vec<WrapSeg>> = None;

    let emit = |segs: &[WrapSeg], line: &mut Vec<Span<'static>>| {
        for seg in segs {
            line.push(Span::styled(seg.text.clone(), seg.style));
        }
    };

    let push_newline = |out: &mut Vec<Line<'static>>,
                        line: &mut Vec<Span<'static>>,
                        avail: &mut usize,
                        w: &mut usize,
                        ws: &mut Option<Vec<WrapSeg>>| {
        out.push(Line::from(coalesce_line_spans(std::mem::take(line))));
        *line = cont_prefix.to_vec();
        *avail = cont_avail;
        *w = 0;
        *ws = None;
    };

    if first_prefix_w >= budget && cont_avail >= 4 {
        push_newline(
            &mut out,
            &mut cur_line,
            &mut cur_avail,
            &mut cur_w,
            &mut pending_ws,
        );
    }

    for token in tokens {
        match token {
            WrapTok::Newline => {
                push_newline(
                    &mut out,
                    &mut cur_line,
                    &mut cur_avail,
                    &mut cur_w,
                    &mut pending_ws,
                );
            }
            WrapTok::Ws(ws) => {
                if cur_w > 0 {
                    pending_ws = Some(ws);
                }
            }
            WrapTok::Word(word) => {
                let word_w = wrap_segs_width(&word);
                let ws_w = pending_ws.as_deref().map_or(0, wrap_segs_width);
                if cur_w + ws_w + word_w <= cur_avail {
                    if let Some(ws) = pending_ws.take() {
                        emit(&ws, &mut cur_line);
                        cur_w += ws_w;
                    }
                    emit(&word, &mut cur_line);
                    cur_w += word_w;
                    continue;
                }
                if cur_w > 0 && word_w <= cont_avail {
                    push_newline(
                        &mut out,
                        &mut cur_line,
                        &mut cur_avail,
                        &mut cur_w,
                        &mut pending_ws,
                    );
                    emit(&word, &mut cur_line);
                    cur_w += word_w;
                    continue;
                }
                for chunk in split_word_soft(&word) {
                    let chunk_w = wrap_segs_width(&chunk);
                    let pws_w = pending_ws.as_deref().map_or(0, wrap_segs_width);
                    if cur_w + pws_w + chunk_w <= cur_avail {
                        if let Some(ws) = pending_ws.take() {
                            emit(&ws, &mut cur_line);
                            cur_w += pws_w;
                        }
                        emit(&chunk, &mut cur_line);
                        cur_w += chunk_w;
                        continue;
                    }
                    if cur_w > 0 {
                        push_newline(
                            &mut out,
                            &mut cur_line,
                            &mut cur_avail,
                            &mut cur_w,
                            &mut pending_ws,
                        );
                    }
                    if chunk_w <= cur_avail {
                        emit(&chunk, &mut cur_line);
                        cur_w += chunk_w;
                    } else {
                        for (p_idx, piece) in
                            split_segs_width(&chunk, cur_avail).into_iter().enumerate()
                        {
                            if p_idx > 0 {
                                push_newline(
                                    &mut out,
                                    &mut cur_line,
                                    &mut cur_avail,
                                    &mut cur_w,
                                    &mut pending_ws,
                                );
                            }
                            let pw = wrap_segs_width(&piece);
                            emit(&piece, &mut cur_line);
                            cur_w += pw;
                        }
                    }
                }
            }
        }
    }

    out.push(Line::from(coalesce_line_spans(cur_line)));
    out
}

/// Computes the exact number of visual rows `lines` occupy when rendered inside
/// a `Paragraph::wrap(Wrap { trim: false })` of width `width`.
pub(crate) fn visual_line_count(lines: &[Line<'_>], width: u16) -> usize {
    let w = width as usize;
    if w == 0 {
        return 0;
    }
    if lines.is_empty() {
        return 0;
    }
    let mut total_rows = 0usize;
    for line in lines {
        let text: String = line.spans.iter().map(|s| s.content.as_ref()).collect();
        if text.is_empty() {
            total_rows += 1;
            continue;
        }
        for subline in text.split('\n') {
            if subline.is_empty() {
                total_rows += 1;
                continue;
            }
            if display_width(subline) <= w {
                total_rows += 1;
                continue;
            }
            let mut rows = 1usize;
            let mut col = 0usize;
            let mut pending_ws = 0usize;
            let mut chars = subline.chars().peekable();
            while let Some(&ch) = chars.peek() {
                if ch.is_whitespace() {
                    let mut ws_w = 0usize;
                    while let Some(&c) = chars.peek() {
                        if !c.is_whitespace() {
                            break;
                        }
                        ws_w += char_display_width(c);
                        chars.next();
                    }
                    if col == 0 {
                        // With trim: false, leading whitespace occupies space on the line.
                        let used = ws_w.min(w);
                        col += used;
                    } else {
                        pending_ws += ws_w;
                    }
                } else {
                    let mut word_w = 0usize;
                    let mut word_chars = Vec::new();
                    while let Some(&c) = chars.peek() {
                        if c.is_whitespace() {
                            break;
                        }
                        let cw = char_display_width(c);
                        word_w += cw;
                        word_chars.push((c, cw));
                        chars.next();
                    }
                    if col > 0 && col + pending_ws + word_w <= w {
                        col += pending_ws + word_w;
                        pending_ws = 0;
                    } else if col > 0 && word_w <= w {
                        rows += 1;
                        col = word_w;
                        pending_ws = 0;
                    } else if col == 0 && word_w <= w {
                        col = word_w;
                        pending_ws = 0;
                    } else {
                        // Word is wider than `w` (or overflows current line and `w`).
                        if col > 0 && col + pending_ws >= w {
                            rows += 1;
                            col = 0;
                        } else {
                            col += pending_ws;
                        }
                        pending_ws = 0;
                        for (_, cw) in word_chars {
                            if col + cw > w && col > 0 {
                                rows += 1;
                                col = 0;
                            }
                            col += cw;
                        }
                    }
                }
            }
            total_rows += rows;
        }
    }
    total_rows
}

pub(crate) fn hairline(width: u16) -> Line<'static> {
    let count = width as usize;
    Line::styled("─".repeat(count), hairline_style())
}

pub(crate) fn section_rule(label: &str, width: u16) -> Line<'static> {
    let total = (width as usize).saturating_sub(2);
    if total <= 6 {
        let count = total.min(width as usize);
        return Line::styled("─".repeat(count), hairline_style());
    }
    let max_label = total - 6;
    let shown_label = truncate_display_width(label, max_label);
    let used = 6 + display_width(&shown_label);
    let fill = total.saturating_sub(used);
    Line::from(vec![
        Span::styled("  ── ", hairline_style()),
        Span::styled(
            shown_label,
            Style::default().fg(ICE_DIM).add_modifier(Modifier::BOLD),
        ),
        Span::styled(" ", hairline_style()),
        Span::styled("─".repeat(fill), hairline_style()),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn section_rule_truncates_label_to_never_exceed_width_minus_two() {
        for w in [8u16, 12, 18, 24, 40, 80] {
            let line = section_rule("Very Long Section Header Name", w);
            assert!(
                line.width() <= w.saturating_sub(2) as usize,
                "width={w} produced rule width {}",
                line.width()
            );
        }
        assert!(section_rule("Anything", 4).width() <= 4);
    }
}
