//! Rich terminal Markdown renderer for Ratatui.
//!
//! Parses Markdown syntax (headers, code blocks, bullet/numbered lists,
//! blockquotes, horizontal rules, bold, italic, inline code) into styled
//! Ratatui `Line`s and `Span`s with the Frost palette.

use crate::ui::theme::{
    accent_bold, frost_glow, hairline_style, ice_mid, muted, FROST_GLOW, ICE_BRIGHT, ICE_DIM,
    SURFACE_PILL,
};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};

/// Converts raw Markdown text into styled Ratatui `Line`s.
pub fn render_markdown(input: &str) -> Vec<Line<'static>> {
    let mut lines = Vec::new();
    let mut in_code_block = false;

    for raw_line in input.lines() {
        let trimmed = raw_line.trim_end();

        // Fenced code blocks: ```lang ... ```
        if trimmed.starts_with("```") {
            if in_code_block {
                in_code_block = false;
                lines.push(Line::styled(
                    "  ╰────────────────────────────────────────────────────────",
                    hairline_style(),
                ));
            } else {
                in_code_block = true;
                let code_lang = trimmed.trim_start_matches('`').trim();
                let label = if code_lang.is_empty() {
                    "[code]".to_string()
                } else {
                    format!("[{code_lang}]")
                };
                let fill_len = 52usize.saturating_sub(label.chars().count());
                lines.push(Line::from(vec![
                    Span::styled("  ╭── ", hairline_style()),
                    Span::styled(label, ice_mid()),
                    Span::styled(format!(" {}", "─".repeat(fill_len)), hairline_style()),
                ]));
            }
            continue;
        }

        if in_code_block {
            lines.push(Line::from(vec![
                Span::styled("  │ ", hairline_style()),
                Span::styled(raw_line.to_string(), frost_glow()),
            ]));
            continue;
        }

        // Horizontal rules
        if trimmed == "---" || trimmed == "***" || trimmed == "___" {
            lines.push(Line::styled(
                "  ────────────────────────────────────────────────────────",
                hairline_style(),
            ));
            continue;
        }

        // H1 (# Title)
        if let Some(rest) = trimmed.strip_prefix("# ") {
            if !lines.is_empty() {
                lines.push(Line::from(""));
            }
            lines.push(Line::from(Span::styled(
                format!("  # {rest}"),
                accent_bold().add_modifier(Modifier::UNDERLINED),
            )));
            lines.push(Line::from(""));
            continue;
        }

        // H2 (## Section)
        if let Some(rest) = trimmed.strip_prefix("## ") {
            if !lines.is_empty() {
                lines.push(Line::from(""));
            }
            lines.push(Line::from(Span::styled(
                format!("  ## {rest}"),
                frost_glow().add_modifier(Modifier::BOLD),
            )));
            continue;
        }

        // H3 (### Subhead)
        if let Some(rest) = trimmed.strip_prefix("### ") {
            lines.push(Line::from(Span::styled(
                format!("  ### {rest}"),
                ice_mid().add_modifier(Modifier::BOLD),
            )));
            continue;
        }

        // H4 (#### Heading 4)
        if let Some(rest) = trimmed.strip_prefix("#### ") {
            lines.push(Line::from(Span::styled(
                format!("  #### {rest}"),
                Style::default().fg(ICE_DIM).add_modifier(Modifier::BOLD),
            )));
            continue;
        }

        // Blockquotes (> quote or bare >)
        if trimmed == ">" {
            lines.push(Line::from(Span::styled("  │ ", ice_mid())));
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("> ") {
            let mut spans = vec![Span::styled("  │ ", ice_mid())];
            spans.extend(parse_inline_spans(
                rest,
                muted().add_modifier(Modifier::ITALIC),
            ));
            lines.push(Line::from(spans));
            continue;
        }

        // Markdown tables (| col | col |)
        if trimmed.starts_with('|') && trimmed.matches('|').count() >= 2 {
            lines.push(render_table_row(trimmed));
            continue;
        }

        // Nested bullet lists (2+ spaces before -, *, +)
        let leading_spaces = raw_line.len() - raw_line.trim_start_matches(' ').len();
        if leading_spaces >= 2 {
            let after_indent = raw_line.trim_start_matches(' ').trim_end();
            let nested_prefixes = ["- ", "* ", "+ "];
            let mut is_nested = false;
            for bp in nested_prefixes {
                if let Some(rest) = after_indent.strip_prefix(bp) {
                    let indent = " ".repeat(2 + leading_spaces.min(6));
                    let mut spans = vec![Span::raw(indent), Span::styled("· ", ice_mid())];
                    spans.extend(parse_inline_spans(rest, Style::default()));
                    lines.push(Line::from(spans));
                    is_nested = true;
                    break;
                }
            }
            if is_nested {
                continue;
            }
        }

        // Bullet lists (- item, * item, + item)
        let bullet_prefixes = ["- ", "* ", "+ "];
        let mut is_bullet = false;
        for bp in bullet_prefixes {
            if let Some(rest) = trimmed.strip_prefix(bp) {
                let mut spans = vec![Span::styled("  • ", accent_bold())];
                spans.extend(parse_inline_spans(rest, Style::default()));
                lines.push(Line::from(spans));
                is_bullet = true;
                break;
            }
        }
        if is_bullet {
            continue;
        }

        // Numbered lists (e.g. "1. ", "2. ")
        if let Some(pos) = trimmed.find(". ") {
            if pos > 0 && trimmed[..pos].chars().all(|c| c.is_ascii_digit()) {
                let num = &trimmed[..=pos];
                let rest = &trimmed[pos + 2..];
                let mut spans = vec![Span::styled(
                    format!("  {num} "),
                    Style::default().fg(ICE_DIM).add_modifier(Modifier::BOLD),
                )];
                spans.extend(parse_inline_spans(rest, Style::default()));
                lines.push(Line::from(spans));
                continue;
            }
        }

        // Empty line
        if trimmed.is_empty() {
            lines.push(Line::from(""));
            continue;
        }

        // Standard text with inline formatting
        let mut spans = vec![Span::raw("  ")];
        spans.extend(parse_inline_spans(trimmed, Style::default()));
        lines.push(Line::from(spans));
    }

    // Close dangling code block if input ended inside one
    if in_code_block {
        lines.push(Line::styled(
            "  ╰────────────────────────────────────────────────────────",
            hairline_style(),
        ));
    }

    lines
}

fn render_table_row(row: &str) -> Line<'static> {
    let is_separator = row.chars().all(|c| matches!(c, '|' | '-' | ':' | ' '));
    if is_separator {
        let mut sep = String::from("  ");
        for ch in row.chars() {
            match ch {
                '|' => sep.push('┼'),
                '-' | ':' => sep.push('─'),
                _ => sep.push('─'),
            }
        }
        return Line::styled(sep, hairline_style());
    }

    let mut spans = vec![Span::raw("  ")];
    let parts: Vec<&str> = row.split('|').collect();
    for (idx, part) in parts.iter().enumerate() {
        if idx > 0 {
            spans.push(Span::styled("│", hairline_style()));
        }
        if !part.is_empty() {
            spans.extend(parse_inline_spans(part, frost_glow()));
        }
    }
    Line::from(spans)
}

/// Parses inline Markdown formatting: `code`, **bold**, *italic*.
pub fn parse_inline_spans(text: &str, base_style: Style) -> Vec<Span<'static>> {
    let mut spans = Vec::new();
    let mut chars = text.chars().peekable();
    let mut buffer = String::new();

    while let Some(ch) = chars.next() {
        // Inline code: `code`
        if ch == '`' {
            if !buffer.is_empty() {
                spans.push(Span::styled(std::mem::take(&mut buffer), base_style));
            }
            let mut code_buf = String::new();
            while let Some(&c) = chars.peek() {
                chars.next();
                if c == '`' {
                    break;
                }
                code_buf.push(c);
            }
            spans.push(Span::styled(
                format!(" {code_buf} "),
                Style::default()
                    .fg(ICE_BRIGHT)
                    .bg(SURFACE_PILL)
                    .add_modifier(Modifier::BOLD),
            ));
            continue;
        }

        // Bold: **text**
        if ch == '*' && chars.peek() == Some(&'*') {
            chars.next(); // consume second '*'
            if !buffer.is_empty() {
                spans.push(Span::styled(std::mem::take(&mut buffer), base_style));
            }
            let mut bold_buf = String::new();
            while let Some(&c) = chars.peek() {
                chars.next();
                if c == '*' && chars.peek() == Some(&'*') {
                    chars.next();
                    break;
                }
                bold_buf.push(c);
            }
            spans.push(Span::styled(
                bold_buf,
                base_style.add_modifier(Modifier::BOLD).fg(FROST_GLOW),
            ));
            continue;
        }

        // Italic: *text* (single star)
        if ch == '*' {
            if !buffer.is_empty() {
                spans.push(Span::styled(std::mem::take(&mut buffer), base_style));
            }
            let mut italic_buf = String::new();
            while let Some(&c) = chars.peek() {
                chars.next();
                if c == '*' {
                    break;
                }
                italic_buf.push(c);
            }
            spans.push(Span::styled(
                italic_buf,
                base_style.add_modifier(Modifier::ITALIC),
            ));
            continue;
        }

        buffer.push(ch);
    }

    if !buffer.is_empty() {
        spans.push(Span::styled(buffer, base_style));
    }

    spans
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_headers() {
        let md = "# Title\n## Section\n### Subhead\n#### Heading 4";
        let lines = render_markdown(md);
        assert!(lines.iter().any(|l| l.to_string().contains("# Title")));
        assert!(lines.iter().any(|l| l.to_string().contains("## Section")));
        assert!(lines.iter().any(|l| l.to_string().contains("### Subhead")));
        assert!(lines
            .iter()
            .any(|l| l.to_string().contains("#### Heading 4")));
    }

    #[test]
    fn renders_code_block() {
        let md = "```rust\nfn main() {}\n```";
        let lines = render_markdown(md);
        assert!(lines.iter().any(|l| l.to_string().contains("[rust]")));
        assert!(lines.iter().any(|l| l.to_string().contains("fn main() {}")));
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
    fn renders_tables_and_nested_bullets() {
        let md = "| Key | Value |\n| --- | --- |\n| Foo | Bar |\n  - Nested item";
        let lines = render_markdown(md);
        assert!(lines.iter().any(|l| l.to_string().contains("┼")));
        assert!(lines.iter().any(|l| l.to_string().contains("Foo")));
        assert!(lines
            .iter()
            .any(|l| l.to_string().contains("· Nested item")));
    }
}
