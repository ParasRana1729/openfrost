//! Rich terminal Markdown renderer for Ratatui.
//!
//! Parses Markdown syntax (headers, code blocks, tables with dynamic column
//! sizing and cell wrapping, links, bullet/task/numbered lists, blockquotes,
//! horizontal rules, bold, italic, bold+italic, strikethrough, inline code,
//! and backslash escapes) into pre-wrapped, styled Ratatui `Line`s and `Span`s
//! using the Glacier Ink palette.

use crate::ui::theme::{
    accent_bold, frost_glow, hairline_style, ice_mid, muted, success, FROST_GLOW, ICE_BRIGHT,
    ICE_DIM, ICE_MID, SURFACE_PILL,
};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};

/// Default render width used by [`render_markdown`].
const DEFAULT_RENDER_WIDTH: usize = 80;

/// Converts raw Markdown text into styled Ratatui `Line`s pre-wrapped for an
/// 80-column viewport.
pub fn render_markdown(input: &str) -> Vec<Line<'static>> {
    render_markdown_for_width(input, DEFAULT_RENDER_WIDTH)
}

/// Converts raw Markdown text into styled Ratatui `Line`s pre-wrapped to fit
/// cleanly within `width` display columns (with a 2-space left margin and right
/// breathing room).
pub fn render_markdown_for_width(input: &str, width: usize) -> Vec<Line<'static>> {
    let mut lines: Vec<Line<'static>> = Vec::new();
    let mut in_code_block = false;
    let mut table_buffer: Vec<String> = Vec::new();
    let mut sources_heading_level: Option<u8> = None;

    let total_budget = line_budget_for_width(width);
    let rule_len = rule_length_for_width(width);

    for raw_line in input.lines() {
        let trimmed = raw_line.trim_end();
        let trimmed_start = trimmed.trim_start();

        // Fenced code blocks: ```lang ... ```
        if trimmed_start.starts_with("```") {
            flush_table(&mut table_buffer, &mut lines, width, total_budget);
            if in_code_block {
                in_code_block = false;
                lines.push(render_code_bottom_border(rule_len));
            } else {
                in_code_block = true;
                let code_lang = trimmed_start.trim_start_matches('`').trim();
                lines.push(render_code_top_border(code_lang, rule_len));
            }
            continue;
        }

        if in_code_block {
            render_code_line(raw_line, total_budget, &mut lines);
            continue;
        }

        // Buffer consecutive Markdown table lines (| ... |)
        if is_table_candidate_line(trimmed) {
            table_buffer.push(trimmed.to_string());
            continue;
        }

        if !table_buffer.is_empty() {
            flush_table(&mut table_buffer, &mut lines, width, total_budget);
        }

        // Horizontal rules (---, ***, ___, - - -)
        if is_horizontal_rule(trimmed) {
            lines.push(Line::styled(
                format!("  {}", "─".repeat(rule_len)),
                hairline_style(),
            ));
            continue;
        }

        // Headings (# .. ######)
        if let Some((level, rest)) = parse_heading(trimmed) {
            update_sources_section(&mut sources_heading_level, level, rest);
            render_heading(level, rest, total_budget, &mut lines);
            continue;
        }

        let in_sources = sources_heading_level.is_some();

        // Blockquotes (> quote, > > nested, or bare >)
        if let Some((depth, rest)) = parse_blockquote(trimmed) {
            render_blockquote_line(depth, rest, in_sources, total_budget, &mut lines);
            continue;
        }

        // Bullet lists, task lists, and numbered lists (top-level & nested)
        if let Some((first_prefix, cont_prefix, rest)) = parse_list_item(raw_line) {
            let inline = parse_inline_spans_impl(rest, Style::default(), in_sources);
            lines.extend(wrap_spans_to_lines(
                &inline,
                &first_prefix,
                &cont_prefix,
                total_budget,
            ));
            continue;
        }

        // Empty line (collapse redundant double blank lines, e.g. right after H1)
        if trimmed.is_empty() {
            if !lines.is_empty() && !last_line_is_blank(&lines) {
                lines.push(Line::from(""));
            }
            continue;
        }

        // Standard paragraph text with inline formatting
        let inline = parse_inline_spans_impl(trimmed, Style::default(), in_sources);
        let margin = vec![Span::raw("  ")];
        lines.extend(wrap_spans_to_lines(&inline, &margin, &margin, total_budget));
    }

    if !table_buffer.is_empty() {
        flush_table(&mut table_buffer, &mut lines, width, total_budget);
    }

    // Close dangling code block if input ended inside one
    if in_code_block {
        lines.push(render_code_bottom_border(rule_len));
    }

    lines
}

/// Parses inline Markdown formatting: `` `code` ``, `[label](url)`,
/// `***bold italic***`, `**bold**`, `__bold__`, `*italic*`, `_italic_`,
/// `~~strike~~`, and backslash escapes (`\*`, `\[`, `` \` ``, etc.).
pub fn parse_inline_spans(text: &str, base_style: Style) -> Vec<Span<'static>> {
    parse_inline_spans_impl(text, base_style, false)
}

// ---------------------------------------------------------------------------
// Width & Display Metrics
// ---------------------------------------------------------------------------

fn line_budget_for_width(width: usize) -> usize {
    let right_breathing = if width >= 28 { 2 } else { 0 };
    width.saturating_sub(right_breathing).max(16)
}

fn rule_length_for_width(width: usize) -> usize {
    if width >= 24 {
        width.saturating_sub(4).clamp(20, 88)
    } else {
        width.saturating_sub(2).max(16)
    }
}

fn str_display_width(s: &str) -> usize {
    if s.is_ascii() {
        s.bytes().filter(|&b| !b.is_ascii_control()).count()
    } else {
        Span::raw(s).width()
    }
}

fn char_display_width(ch: char) -> usize {
    if ch.is_ascii() {
        usize::from(!ch.is_ascii_control())
    } else {
        let mut buf = [0u8; 4];
        let s: &str = ch.encode_utf8(&mut buf);
        Span::raw(s).width()
    }
}

fn spans_display_width(spans: &[Span<'_>]) -> usize {
    spans.iter().map(Span::width).sum()
}

fn last_line_is_blank(lines: &[Line<'_>]) -> bool {
    lines.last().is_some_and(|l| l.spans.is_empty())
}

// ---------------------------------------------------------------------------
// Headings, Rules, Code Blocks, Blockquotes, Lists
// ---------------------------------------------------------------------------

fn is_horizontal_rule(trimmed: &str) -> bool {
    let stripped: String = trimmed.chars().filter(|c| !c.is_whitespace()).collect();
    if stripped.len() < 3 {
        return false;
    }
    stripped.chars().all(|c| c == '-')
        || stripped.chars().all(|c| c == '*')
        || stripped.chars().all(|c| c == '_')
}

fn parse_heading(trimmed: &str) -> Option<(u8, &str)> {
    let hashes = trimmed.bytes().take_while(|&b| b == b'#').count();
    if !(1..=6).contains(&hashes) {
        return None;
    }
    let after = &trimmed[hashes..];
    if after.is_empty() {
        return Some((hashes as u8, ""));
    }
    let rest = after.strip_prefix(' ')?;
    Some((hashes as u8, rest.trim()))
}

fn update_sources_section(sources_level: &mut Option<u8>, level: u8, heading_text: &str) {
    let lower = heading_text.to_ascii_lowercase();
    let is_source_heading = ["source", "url", "reference", "citation", "link"]
        .iter()
        .any(|kw| lower.contains(kw));

    if is_source_heading {
        *sources_level = Some(level);
    } else if sources_level.is_some_and(|sl| level <= sl) {
        *sources_level = None;
    }
}

fn render_heading(level: u8, text: &str, total_budget: usize, lines: &mut Vec<Line<'static>>) {
    let style = match level {
        1 => Style::default()
            .fg(ICE_BRIGHT)
            .add_modifier(Modifier::BOLD | Modifier::UNDERLINED),
        2 => Style::default().fg(FROST_GLOW).add_modifier(Modifier::BOLD),
        3 => Style::default().fg(ICE_MID).add_modifier(Modifier::BOLD),
        _ => Style::default().fg(ICE_DIM).add_modifier(Modifier::BOLD),
    };

    if matches!(level, 1 | 2) && !lines.is_empty() && !last_line_is_blank(lines) {
        lines.push(Line::from(""));
    }

    let margin = vec![Span::raw("  ")];
    if text.is_empty() {
        lines.push(Line::from(margin));
    } else {
        let inline = parse_inline_spans_impl(text, style, false);
        lines.extend(wrap_spans_to_lines(&inline, &margin, &margin, total_budget));
    }

    if level == 1 && !text.is_empty() {
        lines.push(Line::from(""));
    }
}

fn render_code_top_border(code_lang: &str, rule_len: usize) -> Line<'static> {
    let label = if code_lang.is_empty() {
        "[code]".to_string()
    } else {
        format!("[{code_lang}]")
    };
    let prefix_after_margin = 4 + str_display_width(&label) + 1;
    let fill_len = rule_len.saturating_sub(prefix_after_margin).max(1);
    Line::from(vec![
        Span::styled("  ╭── ", hairline_style()),
        Span::styled(label, ice_mid()),
        Span::styled(format!(" {}", "─".repeat(fill_len)), hairline_style()),
    ])
}

fn render_code_bottom_border(rule_len: usize) -> Line<'static> {
    let fill = rule_len.saturating_sub(1);
    Line::styled(format!("  ╰{}", "─".repeat(fill)), hairline_style())
}

fn render_code_line(raw_line: &str, total_budget: usize, lines: &mut Vec<Line<'static>>) {
    let rail_width = 4; // "  │ "
    let code_avail = total_budget.saturating_sub(rail_width).max(12);
    let clean = raw_line.replace('\t', "    ");
    if str_display_width(&clean) <= code_avail {
        lines.push(Line::from(vec![
            Span::styled("  │ ", hairline_style()),
            Span::styled(clean, frost_glow()),
        ]));
        return;
    }

    // Wrap long code lines while preserving leading indentation on the first line
    // and keeping the "  │ " rail on every visual line.
    let mut remaining = clean.as_str();
    while !remaining.is_empty() {
        let split_byte = split_index_by_width(remaining, code_avail);
        let (chunk, rest) = remaining.split_at(split_byte);
        lines.push(Line::from(vec![
            Span::styled("  │ ", hairline_style()),
            Span::styled(chunk.to_string(), frost_glow()),
        ]));
        remaining = rest;
    }
}

fn parse_blockquote(trimmed: &str) -> Option<(usize, &str)> {
    let mut depth = 0usize;
    let mut rest = trimmed;
    loop {
        let after_ws = rest.trim_start();
        if let Some(after_gt) = after_ws.strip_prefix('>') {
            depth += 1;
            rest = after_gt.strip_prefix(' ').unwrap_or(after_gt);
        } else {
            break;
        }
    }
    if depth == 0 {
        None
    } else {
        Some((depth, rest))
    }
}

fn render_blockquote_line(
    depth: usize,
    rest: &str,
    in_sources: bool,
    total_budget: usize,
    lines: &mut Vec<Line<'static>>,
) {
    let rail_str = format!("  {}", "│ ".repeat(depth));
    let rail_span = Span::styled(rail_str, ice_mid());

    if rest.trim().is_empty() {
        lines.push(Line::from(rail_span));
        return;
    }

    if let Some((mut list_first, mut list_cont, item_rest)) = parse_list_item_inner(rest, 0) {
        let mut first_prefix = vec![rail_span.clone()];
        first_prefix.append(&mut list_first);
        let mut cont_prefix = vec![rail_span];
        cont_prefix.append(&mut list_cont);

        let inline = parse_inline_spans_impl(
            item_rest,
            muted().add_modifier(Modifier::ITALIC),
            in_sources,
        );
        lines.extend(wrap_spans_to_lines(
            &inline,
            &first_prefix,
            &cont_prefix,
            total_budget,
        ));
        return;
    }

    let prefix = vec![rail_span];
    let inline = parse_inline_spans_impl(rest, muted().add_modifier(Modifier::ITALIC), in_sources);
    lines.extend(wrap_spans_to_lines(&inline, &prefix, &prefix, total_budget));
}

fn parse_list_item(raw_line: &str) -> Option<(Vec<Span<'static>>, Vec<Span<'static>>, &str)> {
    let mut leading_spaces = 0usize;
    let mut byte_idx = 0usize;
    for (idx, ch) in raw_line.char_indices() {
        match ch {
            ' ' => {
                leading_spaces += 1;
                byte_idx = idx + 1;
            }
            '\t' => {
                leading_spaces += 2;
                byte_idx = idx + 1;
            }
            _ => break,
        }
    }
    let after_indent = raw_line[byte_idx..].trim_end();
    let (mut first, mut cont, rest) = parse_list_item_inner(after_indent, leading_spaces)?;
    first.insert(0, Span::raw("  "));
    cont.insert(0, Span::raw("  "));
    Some((first, cont, rest))
}

fn parse_list_item_inner(
    after_indent: &str,
    leading_spaces: usize,
) -> Option<(Vec<Span<'static>>, Vec<Span<'static>>, &str)> {
    let indent_len = if leading_spaces >= 2 {
        leading_spaces.min(6)
    } else {
        0
    };
    let indent = " ".repeat(indent_len);

    // Unordered bullets & task list items: - [ ] / - [x] / - / * / +
    for bp in ["- ", "* ", "+ "] {
        if let Some(rest) = after_indent.strip_prefix(bp) {
            if let Some(task_rest) = rest
                .strip_prefix("[ ] ")
                .or_else(|| (rest == "[ ]").then_some(""))
            {
                let first = vec![Span::raw(indent.clone()), Span::styled("☐ ", ice_mid())];
                let cont = vec![Span::raw(" ".repeat(indent_len + 2))];
                return Some((first, cont, task_rest));
            }
            if let Some(task_rest) = rest
                .strip_prefix("[x] ")
                .or_else(|| rest.strip_prefix("[X] "))
                .or_else(|| (rest == "[x]" || rest == "[X]").then_some(""))
            {
                let first = vec![Span::raw(indent.clone()), Span::styled("☑ ", success())];
                let cont = vec![Span::raw(" ".repeat(indent_len + 2))];
                return Some((first, cont, task_rest));
            }

            let bullet_span = if leading_spaces >= 2 {
                Span::styled("· ", ice_mid())
            } else {
                Span::styled("• ", accent_bold())
            };
            let first = vec![Span::raw(indent), bullet_span];
            let cont = vec![Span::raw(" ".repeat(indent_len + 2))];
            return Some((first, cont, rest));
        }
    }

    // Numbered lists: "1. item", "10. item", etc.
    if let Some(pos) = after_indent.find(". ") {
        if (1..=4).contains(&pos) && after_indent[..pos].bytes().all(|b| b.is_ascii_digit()) {
            let num_marker = format!("{}. ", &after_indent[..pos]);
            let marker_width = str_display_width(&num_marker);
            let rest = &after_indent[pos + 2..];
            let first = vec![
                Span::raw(indent),
                Span::styled(
                    num_marker,
                    Style::default().fg(ICE_DIM).add_modifier(Modifier::BOLD),
                ),
            ];
            let cont = vec![Span::raw(" ".repeat(indent_len + marker_width))];
            return Some((first, cont, rest));
        }
    }

    None
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ColumnAlign {
    Left,
    Center,
    Right,
}

fn is_table_candidate_line(trimmed: &str) -> bool {
    trimmed.starts_with('|') && trimmed.matches('|').count() >= 2
}

fn split_table_cells(row: &str) -> Vec<String> {
    let mut inner = row.trim();
    if let Some(stripped) = inner.strip_prefix('|') {
        inner = stripped;
    }
    if let Some(stripped) = inner.strip_suffix('|') {
        // Keep trailing escaped pipe (`\|`) intact.
        let ends_with_escaped = stripped.ends_with('\\');
        if !ends_with_escaped {
            inner = stripped;
        }
    }

    let mut cells = Vec::new();
    let mut current = String::new();
    let bytes = inner.as_bytes();
    let mut i = 0usize;
    let mut in_code = false;

    while i < bytes.len() {
        if bytes[i] == b'\\' && i + 1 < bytes.len() {
            if bytes[i + 1] == b'|' {
                current.push('|');
                i += 2;
                continue;
            }
            current.push('\\');
            current.push(bytes[i + 1] as char);
            i += 2;
            continue;
        }
        if bytes[i] == b'`' {
            in_code = !in_code;
            current.push('`');
            i += 1;
            continue;
        }
        if bytes[i] == b'|' && !in_code {
            cells.push(current.trim().to_string());
            current.clear();
            i += 1;
            continue;
        }
        let ch = inner[i..].chars().next().expect("valid utf-8 boundary");
        current.push(ch);
        i += ch.len_utf8();
    }
    cells.push(current.trim().to_string());
    cells
}

fn parse_separator_row(cells: &[String]) -> Option<Vec<ColumnAlign>> {
    if cells.is_empty() {
        return None;
    }
    let mut aligns = Vec::with_capacity(cells.len());
    for cell in cells {
        let trimmed = cell.trim();
        if trimmed.is_empty() || !trimmed.chars().all(|c| matches!(c, '-' | ':' | ' ')) {
            return None;
        }
        let compact: String = trimmed.chars().filter(|c| !c.is_whitespace()).collect();
        if !compact.contains('-') {
            return None;
        }
        let left_colon = compact.starts_with(':');
        let right_colon = compact.ends_with(':');
        let align = match (left_colon, right_colon) {
            (true, true) => ColumnAlign::Center,
            (false, true) => ColumnAlign::Right,
            _ => ColumnAlign::Left,
        };
        aligns.push(align);
    }
    Some(aligns)
}

fn flush_table(
    buffer: &mut Vec<String>,
    lines: &mut Vec<Line<'static>>,
    width: usize,
    total_budget: usize,
) {
    if buffer.is_empty() {
        return;
    }
    let raw_rows = std::mem::take(buffer);
    let parsed_rows: Vec<Vec<String>> = raw_rows.iter().map(|r| split_table_cells(r)).collect();

    // Check if we have a valid header + separator row, or a uniform headerless grid.
    let has_separator = parsed_rows.len() >= 2 && parse_separator_row(&parsed_rows[1]).is_some();

    if has_separator {
        let header = parsed_rows[0].clone();
        let alignments = parse_separator_row(&parsed_rows[1]).unwrap_or_default();
        let body = parsed_rows[2..].to_vec();
        let cols = header
            .len()
            .max(alignments.len())
            .max(body.iter().map(Vec::len).max().unwrap_or(0));

        if cols == 0 {
            render_table_fallback_prose(&raw_rows, total_budget, lines);
            return;
        }

        render_structured_table(
            Some(&header),
            &alignments,
            &body,
            cols,
            width,
            total_budget,
            lines,
        );
        return;
    }

    // Headerless multi-row pipe table if >= 2 rows share the same column count >= 2.
    let uniform_cols = if parsed_rows.len() >= 2 {
        let first_len = parsed_rows[0].len();
        if first_len >= 2 && parsed_rows.iter().all(|r| r.len() == first_len) {
            Some(first_len)
        } else {
            None
        }
    } else {
        None
    };

    if let Some(cols) = uniform_cols {
        render_structured_table(
            None,
            &vec![ColumnAlign::Left; cols],
            &parsed_rows,
            cols,
            width,
            total_budget,
            lines,
        );
    } else {
        render_table_fallback_prose(&raw_rows, total_budget, lines);
    }
}

fn render_table_fallback_prose(
    raw_rows: &[String],
    total_budget: usize,
    lines: &mut Vec<Line<'static>>,
) {
    let margin = vec![Span::raw("  ")];
    for row in raw_rows {
        let spans = parse_inline_spans_impl(row, Style::default(), false);
        lines.extend(wrap_spans_to_lines(&spans, &margin, &margin, total_budget));
    }
}

fn render_structured_table(
    header: Option<&[String]>,
    raw_alignments: &[ColumnAlign],
    body: &[Vec<String>],
    cols: usize,
    width: usize,
    total_budget: usize,
    lines: &mut Vec<Line<'static>>,
) {
    let alignments: Vec<ColumnAlign> = (0..cols)
        .map(|c| raw_alignments.get(c).copied().unwrap_or(ColumnAlign::Left))
        .collect();

    let table_avail = if width >= 28 {
        width.saturating_sub(4).max(20)
    } else {
        width.saturating_sub(2).max(16)
    };
    let sep_overhead = 3 * cols.saturating_sub(1);
    let usable = table_avail.saturating_sub(sep_overhead);

    // Fall back to stacked key-value cards when columns would become unreadable strips.
    if cols >= 2 && usable / cols < 10 {
        render_stacked_table_cards(header, body, cols, total_budget, lines);
        return;
    }

    let norm_header = header.map(|h| normalize_row(h, cols));
    let norm_body: Vec<Vec<String>> = body.iter().map(|r| normalize_row(r, cols)).collect();

    let col_widths = compute_column_widths(norm_header.as_deref(), &norm_body, cols, usable);

    let sep_line_str = format!(
        "  {}",
        col_widths
            .iter()
            .map(|&w| "─".repeat(w))
            .collect::<Vec<_>>()
            .join("─┼─")
    );

    if let Some(hdr) = &norm_header {
        let wrapped_hdr = wrap_table_row(hdr, &col_widths, accent_bold());
        emit_wrapped_table_row(&wrapped_hdr, &col_widths, &alignments, lines);
        lines.push(Line::styled(sep_line_str.clone(), hairline_style()));
    }

    let wrapped_body: Vec<Vec<Vec<Line<'static>>>> = norm_body
        .iter()
        .map(|row| wrap_table_row(row, &col_widths, frost_glow()))
        .collect();

    let any_multiline_body = wrapped_body
        .iter()
        .any(|row| row.iter().any(|cell| cell.len() > 1));

    for (idx, wrapped_row) in wrapped_body.iter().enumerate() {
        emit_wrapped_table_row(wrapped_row, &col_widths, &alignments, lines);
        if any_multiline_body && idx + 1 < wrapped_body.len() {
            lines.push(Line::styled(sep_line_str.clone(), hairline_style()));
        }
    }
}

fn normalize_row(row: &[String], cols: usize) -> Vec<String> {
    (0..cols)
        .map(|c| row.get(c).cloned().unwrap_or_default())
        .collect()
}

fn compute_column_widths(
    header: Option<&[String]>,
    body: &[Vec<String>],
    cols: usize,
    usable: usize,
) -> Vec<usize> {
    let mut nat_widths = vec![1usize; cols];

    if let Some(hdr) = header {
        for (c, cell) in hdr.iter().enumerate() {
            let spans = parse_inline_spans_impl(cell, accent_bold(), false);
            nat_widths[c] = nat_widths[c].max(spans_display_width(&spans));
        }
    }
    for row in body {
        for (c, cell) in row.iter().enumerate() {
            let spans = parse_inline_spans_impl(cell, frost_glow(), false);
            nat_widths[c] = nat_widths[c].max(spans_display_width(&spans));
        }
    }

    let total_nat: usize = nat_widths.iter().sum();
    if total_nat <= usable {
        return nat_widths;
    }

    // Water-filling allocation: lock narrow columns at their natural width, then
    // distribute remaining width proportionally across wider columns.
    let mut widths = vec![0usize; cols];
    let mut unlocked: Vec<usize> = (0..cols).collect();
    let mut remaining = usable;

    loop {
        if unlocked.is_empty() {
            break;
        }
        let fair = remaining / unlocked.len();
        let mut locked_any = false;
        let mut next_unlocked = Vec::with_capacity(unlocked.len());
        for &c in &unlocked {
            if nat_widths[c] <= fair {
                widths[c] = nat_widths[c];
                remaining = remaining.saturating_sub(nat_widths[c]);
                locked_any = true;
            } else {
                next_unlocked.push(c);
            }
        }
        unlocked = next_unlocked;
        if !locked_any {
            break;
        }
    }

    if !unlocked.is_empty() {
        let min_floor = 6usize.min(remaining / unlocked.len()).max(1);
        for &c in &unlocked {
            widths[c] = min_floor;
            remaining = remaining.saturating_sub(min_floor);
        }

        let weights: Vec<usize> = unlocked
            .iter()
            .map(|&c| nat_widths[c].saturating_sub(widths[c]).max(1))
            .collect();
        let total_weight: usize = weights.iter().sum();

        if total_weight > 0 && remaining > 0 {
            let mut remainders: Vec<(usize, usize)> = Vec::with_capacity(unlocked.len());
            let mut distributed = 0usize;
            for (idx, &c) in unlocked.iter().enumerate() {
                let numer = remaining * weights[idx];
                let extra = numer / total_weight;
                widths[c] += extra;
                distributed += extra;
                remainders.push((numer % total_weight, c));
            }
            let mut leftover = remaining.saturating_sub(distributed);
            remainders.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
            for (_, c) in remainders {
                if leftover == 0 {
                    break;
                }
                widths[c] += 1;
                leftover -= 1;
            }
        }
    }

    widths
}

fn wrap_table_row(
    row: &[String],
    col_widths: &[usize],
    base_style: Style,
) -> Vec<Vec<Line<'static>>> {
    row.iter()
        .enumerate()
        .map(|(c, cell)| {
            let col_w = col_widths[c].max(1);
            let spans = parse_inline_spans_impl(cell, base_style, false);
            if spans.is_empty() {
                vec![Line::from("")]
            } else {
                wrap_spans_to_lines(&spans, &[], &[], col_w)
            }
        })
        .collect()
}

fn emit_wrapped_table_row(
    wrapped_cells: &[Vec<Line<'static>>],
    col_widths: &[usize],
    alignments: &[ColumnAlign],
    lines: &mut Vec<Line<'static>>,
) {
    let row_height = wrapped_cells.iter().map(Vec::len).max().unwrap_or(1).max(1);

    for line_idx in 0..row_height {
        let mut row_spans = vec![Span::raw("  ")];
        for c in 0..col_widths.len() {
            if c > 0 {
                row_spans.push(Span::styled(" │ ", hairline_style()));
            }
            let target_w = col_widths[c];
            let cell_line = wrapped_cells[c].get(line_idx);
            let cell_w = cell_line.map_or(0, Line::width);
            let pad = target_w.saturating_sub(cell_w);

            let (left_pad, right_pad) = match alignments[c] {
                ColumnAlign::Left => (0, pad),
                ColumnAlign::Right => (pad, 0),
                ColumnAlign::Center => (pad / 2, pad - (pad / 2)),
            };

            if left_pad > 0 {
                row_spans.push(Span::raw(" ".repeat(left_pad)));
            }
            if let Some(cl) = cell_line {
                row_spans.extend(cl.spans.iter().cloned());
            }
            if right_pad > 0 {
                row_spans.push(Span::raw(" ".repeat(right_pad)));
            }
        }
        lines.push(Line::from(coalesce_spans(row_spans)));
    }
}

fn render_stacked_table_cards(
    header: Option<&[String]>,
    body: &[Vec<String>],
    cols: usize,
    total_budget: usize,
    lines: &mut Vec<Line<'static>>,
) {
    let divider_w = total_budget.saturating_sub(4).clamp(12, 32);
    let divider = Line::styled(format!("  {}", "─".repeat(divider_w)), hairline_style());

    let headers: Vec<String> = (0..cols)
        .map(|c| {
            header
                .and_then(|h| h.get(c))
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(ToString::to_string)
                .unwrap_or_else(|| format!("Col {}", c + 1))
        })
        .collect();

    for (row_idx, row) in body.iter().enumerate() {
        if row_idx > 0 {
            lines.push(divider.clone());
        }
        for (c, label) in headers.iter().enumerate() {
            let val = row.get(c).map(String::as_str).unwrap_or("").trim();
            let prefix_label = format!("{label}: ");
            let first_prefix = vec![
                Span::raw("  "),
                Span::styled(prefix_label, ice_mid().add_modifier(Modifier::BOLD)),
            ];
            let cont_prefix = vec![Span::raw("    ")];
            let val_spans = if val.is_empty() {
                vec![Span::styled("—", muted())]
            } else {
                parse_inline_spans(val, frost_glow())
            };
            lines.extend(wrap_spans_to_lines(
                &val_spans,
                &first_prefix,
                &cont_prefix,
                total_budget,
            ));
        }
    }
}

// ---------------------------------------------------------------------------
// Inline Span Parser
// ---------------------------------------------------------------------------

fn parse_inline_spans_impl(
    text: &str,
    base_style: Style,
    show_source_urls: bool,
) -> Vec<Span<'static>> {
    let mut spans = Vec::new();
    let mut buffer = String::new();
    let bytes = text.as_bytes();
    let mut i = 0usize;

    while i < bytes.len() {
        // Backslash escape: \* \[ \] \` \_ \~ \\ etc.
        if bytes[i] == b'\\' {
            if i + 1 < bytes.len() && bytes[i + 1].is_ascii_punctuation() {
                buffer.push(bytes[i + 1] as char);
                i += 2;
                continue;
            }
            buffer.push('\\');
            i += 1;
            continue;
        }

        // Inline code: `code` or ``code`` (must close; never swallows rest of line)
        if bytes[i] == b'`' {
            let tick_count = bytes[i..].iter().take_while(|&&b| b == b'`').count();
            if let Some((close_start, close_end)) =
                find_closing_backticks(text, i + tick_count, tick_count)
            {
                flush_text_buffer(&mut buffer, base_style, &mut spans);
                let mut code = &text[i + tick_count..close_start];
                if tick_count > 1
                    && code.len() >= 2
                    && code.starts_with(' ')
                    && code.ends_with(' ')
                    && code.chars().any(|c| c != ' ')
                {
                    code = &code[1..code.len() - 1];
                }
                spans.push(Span::styled(
                    format!(" {code} "),
                    Style::default()
                        .fg(ICE_BRIGHT)
                        .bg(SURFACE_PILL)
                        .add_modifier(Modifier::BOLD),
                ));
                i = close_end;
                continue;
            }
            for _ in 0..tick_count {
                buffer.push('`');
            }
            i += tick_count;
            continue;
        }

        // Markdown link: [label](url)
        if bytes[i] == b'[' {
            if let Some((label, url, next_i)) = parse_markdown_link(text, i) {
                flush_text_buffer(&mut buffer, base_style, &mut spans);
                let link_style = base_style.fg(ICE_BRIGHT).add_modifier(Modifier::UNDERLINED);
                if label.is_empty() {
                    spans.push(Span::styled(url.clone(), link_style));
                } else {
                    spans.extend(parse_inline_spans_impl(label, link_style, false));
                }

                let label_is_url =
                    label == url || label.starts_with("http://") || label.starts_with("https://");
                let url_is_http = url.starts_with("http://") || url.starts_with("https://");
                if show_source_urls && !label.is_empty() && !label_is_url && url_is_http {
                    spans.push(Span::styled(
                        format!(" ({url})"),
                        Style::default().fg(ICE_DIM),
                    ));
                }
                i = next_i;
                continue;
            }
            buffer.push('[');
            i += 1;
            continue;
        }

        // Strikethrough: ~~text~~
        if text[i..].starts_with("~~") {
            if let Some((inner_end, next_i)) = find_closing_delim(text, i + 2, "~~", false) {
                if inner_end > i + 2 {
                    flush_text_buffer(&mut buffer, base_style, &mut spans);
                    spans.extend(parse_inline_spans_impl(
                        &text[i + 2..inner_end],
                        base_style.add_modifier(Modifier::CROSSED_OUT),
                        show_source_urls,
                    ));
                    i = next_i;
                    continue;
                }
            }
            buffer.push_str("~~");
            i += 2;
            continue;
        }

        // Asterisk emphasis: ***bold italic***, **bold**, *italic*
        if bytes[i] == b'*' {
            let run = bytes[i..].iter().take_while(|&&b| b == b'*').count();
            if run >= 3 {
                if let Some((inner_end, next_i)) = find_closing_delim(text, i + 3, "***", false) {
                    if inner_end > i + 3 {
                        flush_text_buffer(&mut buffer, base_style, &mut spans);
                        spans.extend(parse_inline_spans_impl(
                            &text[i + 3..inner_end],
                            base_style
                                .fg(FROST_GLOW)
                                .add_modifier(Modifier::BOLD | Modifier::ITALIC),
                            show_source_urls,
                        ));
                        i = next_i;
                        continue;
                    }
                }
            }
            if run >= 2 {
                if let Some((inner_end, next_i)) = find_closing_delim(text, i + 2, "**", false) {
                    if inner_end > i + 2 {
                        flush_text_buffer(&mut buffer, base_style, &mut spans);
                        spans.extend(parse_inline_spans_impl(
                            &text[i + 2..inner_end],
                            base_style.fg(FROST_GLOW).add_modifier(Modifier::BOLD),
                            show_source_urls,
                        ));
                        i = next_i;
                        continue;
                    }
                }
                if run == 2 {
                    buffer.push_str("**");
                    i += 2;
                    continue;
                }
            }
            // Single '*' (or fallback from unclosed '***' when '*' matches)
            let next_is_ws = text[i + 1..].chars().next().is_none_or(char::is_whitespace);
            if !next_is_ws {
                if let Some((inner_end, next_i)) = find_closing_single_star(text, i + 1) {
                    if inner_end > i + 1 {
                        flush_text_buffer(&mut buffer, base_style, &mut spans);
                        spans.extend(parse_inline_spans_impl(
                            &text[i + 1..inner_end],
                            base_style.add_modifier(Modifier::ITALIC),
                            show_source_urls,
                        ));
                        i = next_i;
                        continue;
                    }
                }
            }
            buffer.push('*');
            i += 1;
            continue;
        }

        // Underscore emphasis: ___bold italic___, __bold__, _italic_
        // Never triggers inside snake_case or identifiers (alphanumeric boundary guard).
        if bytes[i] == b'_' {
            let run = bytes[i..].iter().take_while(|&&b| b == b'_').count();
            let prev_is_ident = text[..i]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_alphanumeric() || c == '_');
            let next_is_ws = text[i + run..]
                .chars()
                .next()
                .is_none_or(char::is_whitespace);

            if !prev_is_ident && !next_is_ws {
                if run >= 3 {
                    if let Some((inner_end, next_i)) = find_closing_delim(text, i + 3, "___", true)
                    {
                        if inner_end > i + 3 {
                            flush_text_buffer(&mut buffer, base_style, &mut spans);
                            spans.extend(parse_inline_spans_impl(
                                &text[i + 3..inner_end],
                                base_style
                                    .fg(FROST_GLOW)
                                    .add_modifier(Modifier::BOLD | Modifier::ITALIC),
                                show_source_urls,
                            ));
                            i = next_i;
                            continue;
                        }
                    }
                }
                if run >= 2 {
                    if let Some((inner_end, next_i)) = find_closing_delim(text, i + 2, "__", true) {
                        if inner_end > i + 2 {
                            flush_text_buffer(&mut buffer, base_style, &mut spans);
                            spans.extend(parse_inline_spans_impl(
                                &text[i + 2..inner_end],
                                base_style.fg(FROST_GLOW).add_modifier(Modifier::BOLD),
                                show_source_urls,
                            ));
                            i = next_i;
                            continue;
                        }
                    }
                }
                if run == 1 {
                    if let Some((inner_end, next_i)) = find_closing_delim(text, i + 1, "_", true) {
                        if inner_end > i + 1 {
                            flush_text_buffer(&mut buffer, base_style, &mut spans);
                            spans.extend(parse_inline_spans_impl(
                                &text[i + 1..inner_end],
                                base_style.add_modifier(Modifier::ITALIC),
                                show_source_urls,
                            ));
                            i = next_i;
                            continue;
                        }
                    }
                }
            }

            for _ in 0..run {
                buffer.push('_');
            }
            i += run;
            continue;
        }

        let ch = text[i..].chars().next().expect("valid utf-8 boundary");
        buffer.push(ch);
        i += ch.len_utf8();
    }

    flush_text_buffer(&mut buffer, base_style, &mut spans);
    coalesce_spans(spans)
}

fn flush_text_buffer(buffer: &mut String, style: Style, spans: &mut Vec<Span<'static>>) {
    if !buffer.is_empty() {
        spans.push(Span::styled(std::mem::take(buffer), style));
    }
}

fn coalesce_spans(spans: Vec<Span<'static>>) -> Vec<Span<'static>> {
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

fn find_closing_backticks(text: &str, start: usize, target_count: usize) -> Option<(usize, usize)> {
    let bytes = text.as_bytes();
    let mut i = start;
    while i < bytes.len() {
        if bytes[i] == b'`' {
            let run = bytes[i..].iter().take_while(|&&b| b == b'`').count();
            if run == target_count {
                return Some((i, i + run));
            }
            i += run;
        } else {
            i += 1;
        }
    }
    None
}

fn skip_inline_code_if_closed(text: &str, i: usize) -> usize {
    let bytes = text.as_bytes();
    let run = bytes[i..].iter().take_while(|&&b| b == b'`').count();
    if let Some((_, close_end)) = find_closing_backticks(text, i + run, run) {
        close_end
    } else {
        i + run
    }
}

fn find_closing_delim(
    text: &str,
    start: usize,
    delim: &str,
    underscore_boundary: bool,
) -> Option<(usize, usize)> {
    let bytes = text.as_bytes();
    let dlen = delim.len();
    let mut i = start;

    while i + dlen <= bytes.len() {
        if bytes[i] == b'\\' && i + 1 < bytes.len() {
            i += 2;
            continue;
        }
        if bytes[i] == b'`' {
            i = skip_inline_code_if_closed(text, i);
            continue;
        }
        if text[i..].starts_with(delim) {
            let prev_is_ws = text[..i]
                .chars()
                .next_back()
                .is_some_and(char::is_whitespace);
            if !prev_is_ws {
                if underscore_boundary {
                    // Reject intraword underscores like _foo_bar_ at the middle underscore.
                    let next_is_alnum = text[i + dlen..]
                        .chars()
                        .next()
                        .is_some_and(char::is_alphanumeric);
                    if !next_is_alnum {
                        return Some((i, i + dlen));
                    }
                } else {
                    return Some((i, i + dlen));
                }
            }
        }
        let ch = text[i..].chars().next().expect("valid utf-8 boundary");
        i += ch.len_utf8();
    }
    None
}

fn find_closing_single_star(text: &str, start: usize) -> Option<(usize, usize)> {
    let bytes = text.as_bytes();
    let mut i = start;
    while i < bytes.len() {
        if bytes[i] == b'\\' && i + 1 < bytes.len() {
            i += 2;
            continue;
        }
        if bytes[i] == b'`' {
            i = skip_inline_code_if_closed(text, i);
            continue;
        }
        if bytes[i] == b'*' {
            let run = bytes[i..].iter().take_while(|&&b| b == b'*').count();
            if run == 1 {
                let prev_is_ws = text[..i]
                    .chars()
                    .next_back()
                    .is_some_and(char::is_whitespace);
                if !prev_is_ws {
                    return Some((i, i + 1));
                }
                i += 1;
                continue;
            }
            // If there is a nested **...** pair, jump past it; otherwise if run == 3
            // (e.g. *italic **bold***), let the trailing '*' close the italic run.
            if run == 2 {
                if let Some((_, close_bold)) = find_closing_delim(text, i + 2, "**", false) {
                    i = close_bold;
                    continue;
                }
            }
            if run >= 3 {
                let prev_is_ws = text[..i]
                    .chars()
                    .next_back()
                    .is_some_and(char::is_whitespace);
                if !prev_is_ws {
                    return Some((i + run - 1, i + run));
                }
            }
            i += run;
            continue;
        }
        let ch = text[i..].chars().next().expect("valid utf-8 boundary");
        i += ch.len_utf8();
    }
    None
}

fn parse_markdown_link(text: &str, open_bracket: usize) -> Option<(&str, String, usize)> {
    let bytes = text.as_bytes();
    if bytes.get(open_bracket) != Some(&b'[') {
        return None;
    }

    let mut i = open_bracket + 1;
    let mut bracket_depth = 1usize;
    let mut close_bracket = None;

    while i < bytes.len() {
        if bytes[i] == b'\\' && i + 1 < bytes.len() {
            i += 2;
            continue;
        }
        if bytes[i] == b'`' {
            i = skip_inline_code_if_closed(text, i);
            continue;
        }
        if bytes[i] == b'[' {
            bracket_depth += 1;
            i += 1;
            continue;
        }
        if bytes[i] == b']' {
            bracket_depth -= 1;
            if bracket_depth == 0 {
                close_bracket = Some(i);
                break;
            }
            i += 1;
            continue;
        }
        let ch = text[i..].chars().next().expect("valid utf-8 boundary");
        i += ch.len_utf8();
    }

    let close_bracket = close_bracket?;
    if bytes.get(close_bracket + 1) != Some(&b'(') {
        return None;
    }

    let mut p = close_bracket + 2;
    while p < bytes.len() && matches!(bytes[p], b' ' | b'\t') {
        p += 1;
    }

    // Angle-bracketed destination: [label](<https://...>)
    if bytes.get(p) == Some(&b'<') {
        let url_start = p + 1;
        let mut j = url_start;
        let mut url_end = None;
        while j < bytes.len() {
            if bytes[j] == b'\\' && j + 1 < bytes.len() {
                j += 2;
                continue;
            }
            if bytes[j] == b'>' {
                url_end = Some(j);
                j += 1;
                break;
            }
            j += 1;
        }
        let url_end = url_end?;
        while j < bytes.len() && matches!(bytes[j], b' ' | b'\t') {
            j += 1;
        }
        if bytes.get(j) != Some(&b')') {
            j = skip_optional_link_title(text, j)?;
        }
        if bytes.get(j) != Some(&b')') {
            return None;
        }
        let label = &text[open_bracket + 1..close_bracket];
        let url = unescape_link_url(&text[url_start..url_end]);
        return Some((label, url, j + 1));
    }

    // Standard destination with balanced parentheses: [label](https://en.wikipedia.org/wiki/Foo_(bar))
    let url_start = p;
    let mut j = p;
    let mut paren_depth = 1usize;
    let mut url_end: Option<usize> = None;

    while j < bytes.len() {
        if bytes[j] == b'\\' && j + 1 < bytes.len() {
            if url_end.is_some() {
                return None;
            }
            j += 2;
            continue;
        }
        if bytes[j] == b'(' {
            if url_end.is_some() {
                return None;
            }
            paren_depth += 1;
            j += 1;
            continue;
        }
        if bytes[j] == b')' {
            paren_depth -= 1;
            if paren_depth == 0 {
                let end = url_end.unwrap_or(j);
                let label = &text[open_bracket + 1..close_bracket];
                let url = unescape_link_url(text[url_start..end].trim());
                return Some((label, url, j + 1));
            }
            j += 1;
            continue;
        }
        if bytes[j].is_ascii_whitespace() {
            if url_end.is_none() {
                url_end = Some(j);
            }
            j += 1;
            continue;
        }
        if url_end.is_some() {
            // Only an optional quoted title may follow whitespace inside (...).
            j = skip_optional_link_title(text, j)?;
            if bytes.get(j) == Some(&b')') && paren_depth == 1 {
                let end = url_end.unwrap_or(j);
                let label = &text[open_bracket + 1..close_bracket];
                let url = unescape_link_url(text[url_start..end].trim());
                return Some((label, url, j + 1));
            }
            return None;
        }
        let ch = text[j..].chars().next().expect("valid utf-8 boundary");
        j += ch.len_utf8();
    }

    None
}

fn skip_optional_link_title(text: &str, start: usize) -> Option<usize> {
    let bytes = text.as_bytes();
    let quote = *bytes.get(start)?;
    if quote != b'"' && quote != b'\'' {
        return None;
    }
    let mut i = start + 1;
    while i < bytes.len() {
        if bytes[i] == b'\\' && i + 1 < bytes.len() {
            i += 2;
            continue;
        }
        if bytes[i] == quote {
            i += 1;
            while i < bytes.len() && matches!(bytes[i], b' ' | b'\t') {
                i += 1;
            }
            return Some(i);
        }
        i += 1;
    }
    None
}

fn unescape_link_url(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let bytes = raw.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'\\' && i + 1 < bytes.len() && bytes[i + 1].is_ascii_punctuation() {
            out.push(bytes[i + 1] as char);
            i += 2;
        } else {
            let ch = raw[i..].chars().next().expect("valid utf-8 boundary");
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Styled Span Wrapper
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
struct StyledSeg {
    text: String,
    style: Style,
}

#[derive(Clone, Debug)]
enum WrapToken {
    Whitespace(Vec<StyledSeg>),
    Word(Vec<StyledSeg>),
}

fn segs_width(segs: &[StyledSeg]) -> usize {
    segs.iter().map(|s| str_display_width(&s.text)).sum()
}

fn tokenize_spans(spans: &[Span<'static>]) -> Vec<WrapToken> {
    let mut tokens: Vec<WrapToken> = Vec::new();
    let mut cur_is_ws: Option<bool> = None;
    let mut cur_segs: Vec<StyledSeg> = Vec::new();

    let flush_token = |is_ws: Option<bool>, segs: &mut Vec<StyledSeg>, out: &mut Vec<WrapToken>| {
        if segs.is_empty() {
            return;
        }
        let taken = std::mem::take(segs);
        match is_ws {
            Some(true) => out.push(WrapToken::Whitespace(taken)),
            _ => out.push(WrapToken::Word(taken)),
        }
    };

    for span in spans {
        // Keep inline-code pill spaces attached to the code pill so its background
        // stays intact unless the pill itself exceeds line width.
        let keep_spaces_in_word = span.style.bg.is_some();
        let text = span.content.as_ref();

        if keep_spaces_in_word {
            if cur_is_ws == Some(true) {
                flush_token(cur_is_ws, &mut cur_segs, &mut tokens);
            }
            cur_is_ws = Some(false);
            push_styled_seg(&mut cur_segs, text, span.style);
            continue;
        }

        let mut run = String::new();
        let mut run_ws: Option<bool> = None;

        for ch in text.chars() {
            if ch == '\r' {
                continue;
            }
            let ch_ws = ch.is_whitespace();
            if run_ws.is_some() && run_ws != Some(ch_ws) {
                if cur_is_ws != run_ws {
                    flush_token(cur_is_ws, &mut cur_segs, &mut tokens);
                    cur_is_ws = run_ws;
                }
                push_styled_seg(&mut cur_segs, &run, span.style);
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
                flush_token(cur_is_ws, &mut cur_segs, &mut tokens);
                cur_is_ws = run_ws;
            }
            push_styled_seg(&mut cur_segs, &run, span.style);
        }
    }

    flush_token(cur_is_ws, &mut cur_segs, &mut tokens);
    tokens
}

fn push_styled_seg(segs: &mut Vec<StyledSeg>, text: &str, style: Style) {
    if text.is_empty() {
        return;
    }
    if let Some(last) = segs.last_mut() {
        if last.style == style {
            last.text.push_str(text);
            return;
        }
    }
    segs.push(StyledSeg {
        text: text.to_string(),
        style,
    });
}

/// Splits a long word (such as a URL) at soft-break characters (`/`, `?`, `&`,
/// `-`, `=`, `#`, `;`, `,`) while preserving styles across segments.
fn split_word_at_soft_breaks(word: &[StyledSeg]) -> Vec<Vec<StyledSeg>> {
    let flat: Vec<(char, Style)> = word
        .iter()
        .flat_map(|seg| seg.text.chars().map(move |ch| (ch, seg.style)))
        .collect();
    if flat.is_empty() {
        return Vec::new();
    }

    let mut chunks: Vec<Vec<StyledSeg>> = Vec::new();
    let mut cur: Vec<StyledSeg> = Vec::new();

    for idx in 0..flat.len() {
        let (ch, style) = flat[idx];
        let mut buf = [0u8; 4];
        push_styled_seg(&mut cur, ch.encode_utf8(&mut buf), style);

        let next_ch = flat.get(idx + 1).map(|(c, _)| *c);
        let is_break_char = matches!(ch, '/' | '?' | '&' | '-' | '=' | '#' | ';' | ',');
        // Keep "://" together as a single chunk rather than splitting between '/' and '/'.
        let is_double_slash = ch == '/' && next_ch == Some('/');
        if is_break_char && !is_double_slash && idx + 1 < flat.len() {
            chunks.push(std::mem::take(&mut cur));
        }
    }
    if !cur.is_empty() {
        chunks.push(cur);
    }
    chunks
}

fn split_segs_by_width(segs: &[StyledSeg], max_width: usize) -> Vec<Vec<StyledSeg>> {
    let limit = max_width.max(1);
    let mut pieces: Vec<Vec<StyledSeg>> = Vec::new();
    let mut cur: Vec<StyledSeg> = Vec::new();
    let mut cur_w = 0usize;

    for seg in segs {
        for ch in seg.text.chars() {
            let cw = char_display_width(ch);
            if cur_w + cw > limit && !cur.is_empty() {
                pieces.push(std::mem::take(&mut cur));
                cur_w = 0;
            }
            let mut buf = [0u8; 4];
            push_styled_seg(&mut cur, ch.encode_utf8(&mut buf), seg.style);
            cur_w += cw;
        }
    }
    if !cur.is_empty() {
        pieces.push(cur);
    }
    pieces
}

fn split_index_by_width(s: &str, max_width: usize) -> usize {
    let limit = max_width.max(1);
    let mut width_acc = 0usize;
    let mut end_idx = 0usize;
    for (idx, ch) in s.char_indices() {
        let cw = char_display_width(ch);
        if width_acc + cw > limit && idx > 0 {
            break;
        }
        width_acc += cw;
        end_idx = idx + ch.len_utf8();
        if width_acc >= limit {
            break;
        }
    }
    if end_idx == 0 {
        s.chars().next().map_or(0, char::len_utf8)
    } else {
        end_idx
    }
}

/// Wraps `spans` into `Line<'static>`s fitting within `total_budget` display
/// columns, prepending `first_prefix` to the first line and `cont_prefix` to
/// every subsequent wrapped line.
fn wrap_spans_to_lines(
    spans: &[Span<'static>],
    first_prefix: &[Span<'static>],
    cont_prefix: &[Span<'static>],
    total_budget: usize,
) -> Vec<Line<'static>> {
    let first_avail = total_budget
        .saturating_sub(spans_display_width(first_prefix))
        .max(1);
    let cont_avail = total_budget
        .saturating_sub(spans_display_width(cont_prefix))
        .max(1);

    let tokens = tokenize_spans(spans);
    if tokens.is_empty() {
        return vec![Line::from(first_prefix.to_vec())];
    }

    let mut out_lines: Vec<Line<'static>> = Vec::new();
    let mut cur_line: Vec<Span<'static>> = first_prefix.to_vec();
    let mut cur_avail = first_avail;
    let mut cur_content_w = 0usize;
    let mut pending_ws: Option<Vec<StyledSeg>> = None;

    let emit_segs = |segs: &[StyledSeg], line: &mut Vec<Span<'static>>| {
        for seg in segs {
            line.push(Span::styled(seg.text.clone(), seg.style));
        }
    };

    let newline = |out: &mut Vec<Line<'static>>,
                   line: &mut Vec<Span<'static>>,
                   avail: &mut usize,
                   content_w: &mut usize,
                   ws: &mut Option<Vec<StyledSeg>>| {
        out.push(Line::from(coalesce_spans(std::mem::take(line))));
        *line = cont_prefix.to_vec();
        *avail = cont_avail;
        *content_w = 0;
        *ws = None;
    };

    for token in tokens {
        match token {
            WrapToken::Whitespace(ws) => {
                if cur_content_w > 0 {
                    pending_ws = Some(ws);
                }
            }
            WrapToken::Word(word) => {
                let word_w = segs_width(&word);
                let ws_w = pending_ws.as_deref().map_or(0, segs_width);

                // Case 1: Entire word (plus pending whitespace) fits on the current line.
                if cur_content_w + ws_w + word_w <= cur_avail {
                    if let Some(ws) = pending_ws.take() {
                        emit_segs(&ws, &mut cur_line);
                        cur_content_w += ws_w;
                    }
                    emit_segs(&word, &mut cur_line);
                    cur_content_w += word_w;
                    continue;
                }

                // Case 2: Word fits whole on a fresh continuation line -> wrap cleanly at space.
                if cur_content_w > 0 && word_w <= cont_avail {
                    newline(
                        &mut out_lines,
                        &mut cur_line,
                        &mut cur_avail,
                        &mut cur_content_w,
                        &mut pending_ws,
                    );
                    emit_segs(&word, &mut cur_line);
                    cur_content_w += word_w;
                    continue;
                }

                // Case 3: Word is wider than a single line (e.g. a long URL) or wider
                // than first_avail when line has no content yet. Split at soft-break
                // boundaries (/, ?, &, -, =) first, then char-wrap any giant chunk.
                let soft_chunks = split_word_at_soft_breaks(&word);
                for chunk in soft_chunks {
                    let chunk_w = segs_width(&chunk);
                    let pws_w = pending_ws.as_deref().map_or(0, segs_width);

                    if cur_content_w + pws_w + chunk_w <= cur_avail {
                        if let Some(ws) = pending_ws.take() {
                            emit_segs(&ws, &mut cur_line);
                            cur_content_w += pws_w;
                        }
                        emit_segs(&chunk, &mut cur_line);
                        cur_content_w += chunk_w;
                        continue;
                    }

                    if cur_content_w > 0 {
                        newline(
                            &mut out_lines,
                            &mut cur_line,
                            &mut cur_avail,
                            &mut cur_content_w,
                            &mut pending_ws,
                        );
                    }

                    if chunk_w <= cur_avail {
                        emit_segs(&chunk, &mut cur_line);
                        cur_content_w += chunk_w;
                    } else {
                        let pieces = split_segs_by_width(&chunk, cur_avail);
                        for (p_idx, piece) in pieces.into_iter().enumerate() {
                            if p_idx > 0 {
                                newline(
                                    &mut out_lines,
                                    &mut cur_line,
                                    &mut cur_avail,
                                    &mut cur_content_w,
                                    &mut pending_ws,
                                );
                            }
                            let pw = segs_width(&piece);
                            emit_segs(&piece, &mut cur_line);
                            cur_content_w += pw;
                        }
                    }
                }
            }
        }
    }

    if cur_content_w > 0 || out_lines.is_empty() {
        out_lines.push(Line::from(coalesce_spans(cur_line)));
    }

    out_lines
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn line_strings(lines: &[Line<'_>]) -> Vec<String> {
        lines.iter().map(ToString::to_string).collect()
    }

    #[test]
    fn renders_headers() {
        let md = "# Title with **bold**\n## Section `api`\n### Subhead [docs](https://example.com)\n#### Heading 4";
        let lines = render_markdown(md);
        let text_lines = line_strings(&lines);

        assert!(text_lines.iter().any(|l| l.contains("Title with bold")));
        assert!(text_lines.iter().any(|l| l.contains("Section  api ")));
        assert!(text_lines.iter().any(|l| l.contains("Subhead docs")));
        assert!(text_lines.iter().any(|l| l.contains("Heading 4")));

        // Literal '#' markers must be stripped
        assert!(!text_lines.iter().any(|l| l.contains("# Title")));
        assert!(!text_lines.iter().any(|l| l.contains("## Section")));
        assert!(!text_lines.iter().any(|l| l.contains("### Subhead")));
        assert!(!text_lines.iter().any(|l| l.contains("#### Heading 4")));

        // Verify H1/H2/H3/H4 styles
        let h1 = lines
            .iter()
            .find(|l| l.to_string().contains("Title with"))
            .unwrap();
        assert!(h1.spans.iter().any(|s| {
            s.content.contains("Title with")
                && s.style.fg == Some(ICE_BRIGHT)
                && s.style
                    .add_modifier
                    .contains(Modifier::BOLD | Modifier::UNDERLINED)
        }));

        let h2 = lines
            .iter()
            .find(|l| l.to_string().contains("Section"))
            .unwrap();
        assert!(h2.spans.iter().any(|s| {
            s.content.contains("Section")
                && s.style.fg == Some(FROST_GLOW)
                && s.style.add_modifier.contains(Modifier::BOLD)
        }));

        let h3 = lines
            .iter()
            .find(|l| l.to_string().contains("Subhead"))
            .unwrap();
        assert!(h3.spans.iter().any(|s| {
            s.content.contains("Subhead")
                && s.style.fg == Some(ICE_MID)
                && s.style.add_modifier.contains(Modifier::BOLD)
        }));

        let h4 = lines
            .iter()
            .find(|l| l.to_string().contains("Heading 4"))
            .unwrap();
        assert!(h4.spans.iter().any(|s| {
            s.content.contains("Heading 4")
                && s.style.fg == Some(ICE_DIM)
                && s.style.add_modifier.contains(Modifier::BOLD)
        }));
    }

    #[test]
    fn renders_code_block() {
        let md = "```rust\nfn main() {}\n```";
        let lines = render_markdown(md);
        assert!(lines.iter().any(|l| l.to_string().contains("[rust]")));
        assert!(lines.iter().any(|l| l.to_string().contains("fn main() {}")));
    }

    #[test]
    fn adapts_rules_and_code_borders_to_width() {
        let md = "---\n```ts\nconst x = 1;\n```";
        let narrow = render_markdown_for_width(md, 32);
        let wide = render_markdown_for_width(md, 100);

        for l in &narrow {
            assert!(l.width() <= 32, "line exceeded 32: {} ({})", l, l.width());
        }
        let narrow_rule = narrow[0].to_string();
        let wide_rule = wide[0].to_string();
        assert!(wide_rule.chars().count() > narrow_rule.chars().count());
        assert_eq!(narrow_rule.trim_start().chars().count(), 28); // 32 - 4
        assert_eq!(wide_rule.trim_start().chars().count(), 88); // clamped to 88
    }

    #[test]
    fn renders_lists_and_quotes() {
        let md = "- Item 1\n1. Numbered\n> A quote";
        let lines = render_markdown(md);
        assert!(lines.iter().any(|l| l.to_string().contains("• Item 1")));
        assert!(lines.iter().any(|l| l.to_string().contains("1. Numbered")));
        assert!(lines.iter().any(|l| l.to_string().contains("│ A quote")));
    }

    #[test]
    fn preserves_hanging_indents_on_wrapped_lists_and_quotes() {
        let md = "- First bullet item that is definitely long enough to wrap onto multiple lines\n\
                  1. Numbered list item with plenty of words to verify the hanging indent width\n\
                  - [x] Completed task item that wraps cleanly onto the next terminal line\n\
                  > Blockquote text that spans across multiple wrapped lines keeping its rail";
        let lines = render_markdown_for_width(md, 42);
        let strs = line_strings(&lines);

        for l in &lines {
            assert!(l.width() <= 42, "line exceeded width 42: '{}'", l);
        }

        // Bullet continuation lines start with 4 spaces ("    ")
        let bullet_idx = strs.iter().position(|s| s.starts_with("  • ")).unwrap();
        assert!(strs[bullet_idx + 1].starts_with("    "));
        assert!(!strs[bullet_idx + 1].starts_with("    •"));

        // Numbered continuation lines start with 5 spaces ("     ")
        let num_idx = strs.iter().position(|s| s.starts_with("  1. ")).unwrap();
        assert!(strs[num_idx + 1].starts_with("     "));

        // Task list item renders ☑ and continues with 4 spaces
        let task_idx = strs.iter().position(|s| s.starts_with("  ☑ ")).unwrap();
        assert!(strs[task_idx + 1].starts_with("    "));

        // Blockquote continuation lines repeat "  │ "
        let quote_indices: Vec<usize> = strs
            .iter()
            .enumerate()
            .filter_map(|(i, s)| s.starts_with("  │ ").then_some(i))
            .collect();
        assert!(quote_indices.len() >= 2);
    }

    #[test]
    fn renders_inline_formatting() {
        let spans =
            parse_inline_spans("Here is `code` and **bold** and *italic*", Style::default());
        let text = spans
            .iter()
            .map(|s| s.content.as_ref())
            .collect::<Vec<_>>()
            .join("");
        assert!(text.contains("code"));
        assert!(text.contains("bold"));
        assert!(text.contains("italic"));
    }

    #[test]
    fn handles_extended_inline_and_edge_cases() {
        // snake_case must NOT trigger italic
        let snake = parse_inline_spans("Use my_snake_case_var and _italic_text_", Style::default());
        let snake_text: String = snake.iter().map(|s| s.content.as_ref()).collect();
        assert_eq!(snake_text, "Use my_snake_case_var and italic_text");
        assert!(!snake.iter().any(
            |s| s.content.contains("snake") && s.style.add_modifier.contains(Modifier::ITALIC)
        ));
        assert!(snake.iter().any(|s| {
            s.content.contains("italic_text") && s.style.add_modifier.contains(Modifier::ITALIC)
        }));

        // ***bold italic***, __bold__, ~~strike~~, backslash escapes
        let rich = parse_inline_spans(
            r"***both*** __bold__ ~~old~~ \*escaped\* \[notlink\](x) \`nocode\`",
            Style::default(),
        );
        let rich_text: String = rich.iter().map(|s| s.content.as_ref()).collect();
        assert_eq!(rich_text, "both bold old *escaped* [notlink](x) `nocode`");
        assert!(rich.iter().any(|s| {
            s.content == "both"
                && s.style
                    .add_modifier
                    .contains(Modifier::BOLD | Modifier::ITALIC)
        }));
        assert!(rich
            .iter()
            .any(|s| s.content == "bold" && s.style.add_modifier.contains(Modifier::BOLD)));
        assert!(rich.iter().any(|s| {
            s.content == "old" && s.style.add_modifier.contains(Modifier::CROSSED_OUT)
        }));

        // Unclosed delimiters must NOT swallow the rest of the line
        let unclosed = parse_inline_spans(
            "Price is *unclosed and **unclosed bold and `ok` plus `dangling tick",
            Style::default(),
        );
        let unclosed_text: String = unclosed.iter().map(|s| s.content.as_ref()).collect();
        assert!(unclosed_text.contains("*unclosed"));
        assert!(unclosed_text.contains("**unclosed bold"));
        assert!(unclosed_text.contains("`dangling tick"));
        assert!(unclosed
            .iter()
            .any(|s| s.content == " ok " && s.style.bg == Some(SURFACE_PILL)));
    }

    #[test]
    fn parses_links_in_prose_wikipedia_and_sources_sections() {
        // Prose link hides raw URL and styles label
        let prose = "See [investor.nvidia.com](https://investor.nvidia.com/news/very-long-url) and [Wiki](https://en.wikipedia.org/wiki/Rust_(programming_language)).";
        let prose_lines = render_markdown_for_width(prose, 80);
        let prose_joined = line_strings(&prose_lines).join("\n");
        assert!(prose_joined.contains("investor.nvidia.com"));
        assert!(!prose_joined.contains("https://investor.nvidia.com"));
        assert!(prose_joined.contains("Wiki"));
        assert!(!prose_joined.contains("programming_language"));

        // Link span style check
        let link_span = prose_lines[0]
            .spans
            .iter()
            .find(|s| s.content.contains("investor.nvidia.com"))
            .unwrap();
        assert_eq!(link_span.style.fg, Some(ICE_BRIGHT));
        assert!(link_span.style.add_modifier.contains(Modifier::UNDERLINED));

        // Sources section expands label + (url) AND never orphans "2. "
        let sources_md = "## Sources\n\
                          1. [https://example.com/same](https://example.com/same)\n\
                          2. [cnbc.com](https://www.cnbc.com/2026/02/25/nvidia-q4-earnings-report-and-guidance-details.html)";
        let src_lines = render_markdown_for_width(sources_md, 52);
        let src_strs = line_strings(&src_lines);

        for l in &src_lines {
            assert!(l.width() <= 52, "source line exceeded 52: '{}'", l);
        }

        // #1 has label == url -> rendered once, no duplicate "(https://...)"
        let line1 = src_strs.iter().find(|s| s.starts_with("  1. ")).unwrap();
        assert!(!line1.contains("(https://example.com/same)"));

        // #2 is not orphaned on its own line; "2. cnbc.com" stays together and wraps URL cleanly
        let line2 = src_strs.iter().find(|s| s.starts_with("  2. ")).unwrap();
        assert!(line2.contains("cnbc.com"));
        assert!(src_strs.join("\n").contains("https://www.cnbc.com/"));
        assert!(src_strs.iter().any(|s| s.starts_with("     ")));
    }

    #[test]
    fn renders_tables_and_nested_bullets() {
        let md = "| Key | Value |\n| --- | --- |\n| Foo | Bar |\n  - Nested item";
        let lines = render_markdown(md);
        assert!(lines.iter().any(|l| l.to_string().contains("┼")));
        assert!(lines.iter().any(|l| l.to_string().contains("Foo")));
        assert!(lines
            .iter()
            .any(|l| l.to_string().contains("· Nested item")));
    }

    #[test]
    fn aligns_and_wraps_multiline_tables_and_hides_urls() {
        let md = "| Option | Score | Evidence & Source |\n\
                  | :--- | :---: | ---: |\n\
                  | Alpha | 95 | Verified by [investor.nvidia.com](https://investor.nvidia.com/very/long/url/that/should/not/break/columns) with strong revenue growth across data center segments |\n\
                  | Beta | 80 | Secondary option |";
        let lines = render_markdown_for_width(md, 60);
        let strs = line_strings(&lines);

        for l in &lines {
            assert!(l.width() <= 60, "table line exceeded 60: '{}'", l);
        }

        // Raw URL must NOT appear inside table
        let joined = strs.join("\n");
        assert!(!joined.contains("https://investor.nvidia.com"));
        assert!(joined.contains("investor.nvidia.com"));

        // Separator line aligns with │ columns and appears both below header and between multi-line body rows
        let sep_count = strs.iter().filter(|s| s.contains('┼')).count();
        assert_eq!(sep_count, 2);

        // Every table line with │ has the exact same column '│' positions
        let pipe_positions: Vec<Vec<usize>> = strs
            .iter()
            .filter(|s| s.contains('│'))
            .map(|s| {
                s.chars()
                    .enumerate()
                    .filter_map(|(i, c)| (c == '│').then_some(i))
                    .collect()
            })
            .collect();
        assert!(pipe_positions.len() >= 4);
        let first_pipes = &pipe_positions[0];
        for pos in &pipe_positions {
            assert_eq!(pos, first_pipes, "misaligned table pipes: {:?}", strs);
        }
    }

    #[test]
    fn falls_back_to_stacked_cards_for_many_columns_on_narrow_width() {
        let md = "| Col A | Col B | Col C | Col D | Col E |\n\
                  | --- | --- | --- | --- | --- |\n\
                  | One | Two | Three | Four | Five |\n\
                  | Alpha | Beta | Gamma | Delta | Epsilon |";
        let lines = render_markdown_for_width(md, 44);
        let strs = line_strings(&lines);
        for l in &lines {
            assert!(l.width() <= 44, "card line exceeded 44: '{}'", l);
        }
        assert!(!strs.iter().any(|s| s.contains('│')));
        assert!(strs.iter().any(|s| s.contains("Col A: One")));
        assert!(strs.iter().any(|s| s.contains("Col E: Epsilon")));
    }

    #[test]
    fn falls_back_gracefully_on_single_or_malformed_pipe_line() {
        let md = "| just a single pipe line | not a table |";
        let lines = render_markdown_for_width(md, 80);
        let joined = line_strings(&lines).join("\n");
        assert!(joined.contains("just a single pipe line"));
        assert!(!joined.contains('┼'));
    }

    #[test]
    fn wraps_code_lines_nested_lists_task_lists_and_nested_quotes() {
        let md = concat!(
            "```rust\n",
            "let very_long_identifier = \"some_extremely_long_string_value_for_narrow_width\";\n",
            "```\n",
            "- [ ] Unchecked item\n",
            "  1. Nested numbered item with extra words to wrap nicely across lines\n",
            "> > Nested quote line that wraps across multiple lines with double rail",
        );
        let lines = render_markdown_for_width(md, 38);
        let strs = line_strings(&lines);

        for l in &lines {
            assert!(l.width() <= 38, "line exceeded 38: '{}'", l);
        }

        // Wrapped code lines retain "  │ " rail
        let code_rails = strs
            .iter()
            .filter(|s| s.starts_with("  │ ") && s.contains("very_long_identifier"))
            .count();
        assert_eq!(code_rails, 1);
        assert!(strs.iter().filter(|s| s.starts_with("  │ ")).count() >= 2);

        // Task item & nested numbered list hanging indent
        assert!(strs.iter().any(|s| s.starts_with("  ☐ Unchecked item")));
        let nested_num_idx = strs.iter().position(|s| s.starts_with("    1. ")).unwrap();
        assert!(strs[nested_num_idx + 1].starts_with("       "));

        // Nested blockquote repeats "  │ │ "
        let nested_quotes = strs.iter().filter(|s| s.starts_with("  │ │ ")).count();
        assert!(nested_quotes >= 2);
    }

    #[test]
    fn respects_table_column_alignments_and_sources_reset_after_heading() {
        let md = "## References\n\
                  - [Ref One](https://example.com/ref1)\n\
                  ## Overview\n\
                  - [Prose Link](https://example.com/prose)\n\
                  | L | C | R |\n\
                  | :--- | :---: | ---: |\n\
                  | x | y | 7 |\n\
                  | left | center | right |";
        let lines = render_markdown_for_width(md, 80);
        let strs = line_strings(&lines);

        // References shows URL, Overview hides URL
        assert!(strs
            .iter()
            .any(|s| s.contains("Ref One") && s.contains("(https://example.com/ref1)")));
        assert!(strs.iter().any(|s| s.contains("Prose Link")));
        assert!(!strs.iter().any(|s| s.contains("https://example.com/prose")));

        // Verify right-aligned '7' is padded on the left inside its column
        let row = strs.iter().find(|s| s.contains('7')).unwrap();
        assert!(row.ends_with("     7") || row.ends_with("    7"));
    }
}
