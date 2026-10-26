import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';

import { Button } from '../components/ui/Button';
import {
  Card,
  CardBody,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../components/ui/Card';
import { Disclosure } from '../components/ui/Disclosure';

const axeComponentOptions = {
  rules: {
    region: { enabled: false },
  },
};

// =============================================================================
// WCAG Contrast Oracle for Boundary Tokens
// =============================================================================
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function srgbToLinear(c: number): number {
  const norm = c / 255;
  return norm <= 0.04045 ? norm / 12.92 : Math.pow((norm + 0.055) / 1.055, 2.4);
}

function relativeLuminance(rgb: [number, number, number]): number {
  const r = srgbToLinear(rgb[0]);
  const g = srgbToLinear(rgb[1]);
  const b = srgbToLinear(rgb[2]);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatioRgbaOverBg(
  fgRgba: [number, number, number, number],
  bgHex: string,
): number {
  const [fr, fg, fb, a] = fgRgba;
  const [br, bg, bb] = hexToRgb(bgHex);
  const composited: [number, number, number] = [
    Math.round(fr * a + br * (1 - a)),
    Math.round(fg * a + bg * (1 - a)),
    Math.round(fb * a + bb * (1 - a)),
  ];
  const lum1 = relativeLuminance(composited);
  const lum2 = relativeLuminance([br, bg, bb]);
  return (Math.max(lum1, lum2) + 0.05) / (Math.min(lum1, lum2) + 0.05);
}

describe('Challenger M1.3: Empirical Defect Remediation Verification', () => {
  // ===========================================================================
  // 1. Card Primitive: Event Bubbling & Child Control Isolation
  // ===========================================================================
  describe('Card.tsx: Keyboard and Click Isolation with Nested Interactive Children', () => {
    it('does NOT intercept Space keydown from nested text input and does NOT prevent default', () => {
      const handleCardClick = vi.fn();
      render(
        <Card interactive onClick={handleCardClick} aria-label="Task Item">
          <CardBody>
            <input type="text" placeholder="Task query..." data-testid="card-input" />
          </CardBody>
        </Card>,
      );

      const input = screen.getByTestId('card-input');
      input.focus();
      expect(input).toHaveFocus();

      const spaceEvent = new KeyboardEvent('keydown', {
        key: ' ',
        code: 'Space',
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(spaceEvent);

      expect(spaceEvent.defaultPrevented).toBe(false);
      expect(handleCardClick).not.toHaveBeenCalled();
    });

    it('does NOT intercept Enter keydown from nested text input', () => {
      const handleCardClick = vi.fn();
      render(
        <Card interactive onClick={handleCardClick} aria-label="Task Item">
          <CardBody>
            <input type="text" placeholder="Enter query..." data-testid="card-input" />
          </CardBody>
        </Card>,
      );

      const input = screen.getByTestId('card-input');
      input.focus();

      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(enterEvent);

      expect(handleCardClick).not.toHaveBeenCalled();
    });

    it('does NOT intercept Space or Enter keydown from nested textarea', () => {
      const handleCardClick = vi.fn();
      render(
        <Card interactive onClick={handleCardClick} aria-label="Task Note">
          <CardBody>
            <textarea placeholder="Notes..." data-testid="card-textarea" />
          </CardBody>
        </Card>,
      );

      const textarea = screen.getByTestId('card-textarea');
      textarea.focus();

      const spaceEvent = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
      textarea.dispatchEvent(spaceEvent);
      expect(spaceEvent.defaultPrevented).toBe(false);
      expect(handleCardClick).not.toHaveBeenCalled();

      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
      textarea.dispatchEvent(enterEvent);
      expect(enterEvent.defaultPrevented).toBe(false);
      expect(handleCardClick).not.toHaveBeenCalled();
    });

    it('allows nested Button activation via Enter without triggering Card onClick', async () => {
      const user = userEvent.setup();
      const handleCardClick = vi.fn();
      const handleBtnClick = vi.fn();

      render(
        <Card interactive onClick={handleCardClick} aria-label="Action Card">
          <CardBody>Card details</CardBody>
          <CardFooter>
            <Button onClick={handleBtnClick} data-testid="nested-btn">
              Export Run
            </Button>
          </CardFooter>
        </Card>,
      );

      const btn = screen.getByTestId('nested-btn');
      btn.focus();
      expect(btn).toHaveFocus();

      await user.keyboard('{Enter}');
      expect(handleBtnClick).toHaveBeenCalledTimes(1);
      expect(handleCardClick).not.toHaveBeenCalled();
    });

    it('allows nested Button activation via Space without triggering Card onClick', async () => {
      const user = userEvent.setup();
      const handleCardClick = vi.fn();
      const handleBtnClick = vi.fn();

      render(
        <Card interactive onClick={handleCardClick} aria-label="Action Card">
          <CardFooter>
            <Button onClick={handleBtnClick} data-testid="nested-btn">
              Cancel Task
            </Button>
          </CardFooter>
        </Card>,
      );

      const btn = screen.getByTestId('nested-btn');
      btn.focus();

      await user.keyboard(' ');
      expect(handleBtnClick).toHaveBeenCalledTimes(1);
      expect(handleCardClick).not.toHaveBeenCalled();
    });

    it('does NOT intercept keydown from nested select element', () => {
      const handleCardClick = vi.fn();
      render(
        <Card interactive onClick={handleCardClick} aria-label="Filter Card">
          <CardBody>
            <select data-testid="filter-select">
              <option value="all">All</option>
              <option value="running">Running</option>
            </select>
          </CardBody>
        </Card>,
      );

      const select = screen.getByTestId('filter-select');
      select.focus();

      const spaceEvent = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
      select.dispatchEvent(spaceEvent);
      expect(handleCardClick).not.toHaveBeenCalled();
    });

    it('does NOT intercept keydown from nested [role="button"] element', () => {
      const handleCardClick = vi.fn();
      const handleCustomClick = vi.fn();
      render(
        <Card interactive onClick={handleCardClick} aria-label="Container Card">
          <CardBody>
            <div
              role="button"
              tabIndex={0}
              data-testid="custom-child-button"
              onClick={handleCustomClick}
            >
              Custom Role Button
            </div>
          </CardBody>
        </Card>,
      );

      const customBtn = screen.getByTestId('custom-child-button');
      customBtn.focus();

      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
      customBtn.dispatchEvent(enterEvent);
      expect(handleCardClick).not.toHaveBeenCalled();
    });

    it('triggers Card onClick when Card itself is focused and Enter or Space is pressed', async () => {
      const user = userEvent.setup();
      const handleCardClick = vi.fn();
      render(
        <Card interactive onClick={handleCardClick} aria-label="Direct Card">
          <CardBody>Direct Card Content</CardBody>
        </Card>,
      );

      const card = screen.getByRole('button', { name: 'Direct Card' });
      card.focus();
      expect(card).toHaveFocus();

      await user.keyboard('{Enter}');
      expect(handleCardClick).toHaveBeenCalledTimes(1);

      await user.keyboard(' ');
      expect(handleCardClick).toHaveBeenCalledTimes(2);
    });

    it('filters out mouse clicks bubbling from nested interactive elements (button, link, input)', async () => {
      const user = userEvent.setup();
      const handleCardClick = vi.fn();
      const handleBtnClick = vi.fn();
      const handleLinkClick = vi.fn((e: React.MouseEvent) => e.preventDefault());

      render(
        <Card interactive onClick={handleCardClick} aria-label="Container">
          <CardHeader>
            <CardTitle>Title</CardTitle>
          </CardHeader>
          <CardBody>
            <p data-testid="card-text">Some text paragraph</p>
            <input type="checkbox" data-testid="nested-check" />
            <a href="#test" data-testid="nested-link" onClick={handleLinkClick}>
              Link
            </a>
          </CardBody>
          <CardFooter>
            <button type="button" data-testid="nested-native-btn" onClick={handleBtnClick}>
              Click me
            </button>
          </CardFooter>
        </Card>,
      );

      // 1. Click on nested button:
      await user.click(screen.getByTestId('nested-native-btn'));
      expect(handleBtnClick).toHaveBeenCalledTimes(1);
      expect(handleCardClick).not.toHaveBeenCalled();

      // 2. Click on nested checkbox:
      await user.click(screen.getByTestId('nested-check'));
      expect(handleCardClick).not.toHaveBeenCalled();

      // 3. Click on nested link:
      await user.click(screen.getByTestId('nested-link'));
      expect(handleLinkClick).toHaveBeenCalledTimes(1);
      expect(handleCardClick).not.toHaveBeenCalled();

      // 4. Click on non-interactive text paragraph inside Card:
      await user.click(screen.getByTestId('card-text'));
      expect(handleCardClick).toHaveBeenCalledTimes(1);

      // 5. Click on Card container itself:
      await user.click(screen.getByRole('button', { name: 'Container' }));
      expect(handleCardClick).toHaveBeenCalledTimes(2);
    });
  });

  // ===========================================================================
  // 2. Disclosure Primitive: Native & Controlled Modes
  // ===========================================================================
  describe('Disclosure.tsx: Native and Controlled Toggling', () => {
    it('opens and closes cleanly on summary clicks in native mode without double-toggle', async () => {
      const user = userEvent.setup();
      const handleToggle = vi.fn();

      render(
        <Disclosure title="Run Output" onToggle={handleToggle}>
          <div data-testid="disclosure-body">Generated brief content</div>
        </Disclosure>,
      );

      const summaryText = screen.getByText('Run Output');
      const details = summaryText.closest('details') as HTMLDetailsElement;
      const summary = details.querySelector('summary') as HTMLElement;
      expect(details).toBeInTheDocument();
      expect(details.open).toBe(false);

      // First click: opens (verifies fix: e.preventDefault() prevents browser revert)
      await user.click(summary);
      expect(details.open).toBe(true);
      expect(handleToggle).toHaveBeenCalledWith(true);

      // Second click: closes cleanly
      await user.click(summary);
      expect(details.open).toBe(false);
      expect(handleToggle).toHaveBeenCalledWith(false);

      // Third click: opens again
      await user.click(summary);
      expect(details.open).toBe(true);
      expect(handleToggle).toHaveBeenCalledWith(true);
      expect(handleToggle).toHaveBeenCalledTimes(3);
    });

    it('handles programmatic and synthetic toggle events on native details', () => {
      const handleToggle = vi.fn();

      render(
        <Disclosure title="Synthetic Toggle Details" onToggle={handleToggle}>
          <div>Synthetic content</div>
        </Disclosure>,
      );

      const summaryText = screen.getByText('Synthetic Toggle Details');
      const details = summaryText.closest('details') as HTMLDetailsElement;
      expect(details).toBeInTheDocument();

      // Programmatic change followed by native toggle event:
      details.open = true;
      fireEvent(details, new Event('toggle'));
      expect(handleToggle).toHaveBeenCalledWith(true);

      details.open = false;
      fireEvent(details, new Event('toggle'));
      expect(handleToggle).toHaveBeenCalledWith(false);
    });

    it('respects defaultOpen={true} in native mode and toggles closed on click', async () => {
      const user = userEvent.setup();
      const handleToggle = vi.fn();

      render(
        <Disclosure title="Default Open Panel" defaultOpen={true} onToggle={handleToggle}>
          <div>Always visible initially</div>
        </Disclosure>,
      );

      const summary = screen.getByText('Default Open Panel');
      const details = summary.closest('details') as HTMLDetailsElement;
      expect(details.open).toBe(true);

      await user.click(summary);
      expect(details.open).toBe(false);
      expect(handleToggle).toHaveBeenCalledWith(false);
    });

    it('works cleanly in controlled mode with external state', async () => {
      const user = userEvent.setup();

      function ControlledTestHarness() {
        const [open, setOpen] = useState(false);
        return (
          <div>
            <span data-testid="state-indicator">{open ? 'OPEN' : 'CLOSED'}</span>
            <Disclosure
              title="Controlled Panel"
              isOpen={open}
              onToggle={setOpen}
              headingLevel="h3"
            >
              <div>Controlled Panel Children</div>
            </Disclosure>
          </div>
        );
      }

      render(<ControlledTestHarness />);
      expect(screen.getByTestId('state-indicator')).toHaveTextContent('CLOSED');

      const trigger = screen.getByRole('button', { name: /Controlled Panel/ });
      expect(trigger).toHaveAttribute('aria-expanded', 'false');

      await user.click(trigger);
      expect(screen.getByTestId('state-indicator')).toHaveTextContent('OPEN');
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('Controlled Panel Children')).toBeVisible();

      await user.click(trigger);
      expect(screen.getByTestId('state-indicator')).toHaveTextContent('CLOSED');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
  });

  // ===========================================================================
  // 3. Button Primitive: Link Variant Props & Clicks
  // ===========================================================================
  describe('Button.tsx: Link Prop Preservation & Clicks', () => {
    it('preserves aria-label, onClick, data-* attributes, and rel when href is used (external link)', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn((e: React.MouseEvent) => e.preventDefault());

      render(
        <Button
          href="https://example.com/docs"
          asExternalLink
          aria-label="Documentation external link"
          data-testid="external-doc-link"
          id="doc-button"
          title="Go to docs"
          onClick={handleClick}
        >
          View Documentation
        </Button>,
      );

      const link = screen.getByRole('link', { name: 'Documentation external link' });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', 'https://example.com/docs');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
      expect(link).toHaveAttribute('data-testid', 'external-doc-link');
      expect(link).toHaveAttribute('id', 'doc-button');
      expect(link).toHaveAttribute('title', 'Go to docs');

      await user.click(link);
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('preserves aria-label, onClick, and data-* attributes when href is used (internal link)', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn((e: React.MouseEvent) => e.preventDefault());

      render(
        <Button
          href="/tasks/queue"
          aria-label="Queue Management"
          data-testid="internal-queue-link"
          onClick={handleClick}
        >
          Manage Queue
        </Button>,
      );

      const link = screen.getByRole('link', { name: 'Queue Management' });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', '/tasks/queue');
      expect(link).toHaveAttribute('data-testid', 'internal-queue-link');

      await user.click(link);
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('falls back to disabled button and suppresses navigation/clicks when disabled=true with href', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();

      render(
        <Button
          href="/tasks/123"
          disabled
          aria-label="Disabled Task Link"
          onClick={handleClick}
        >
          Disabled Run
        </Button>,
      );

      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      const button = screen.getByRole('button', { name: 'Disabled Task Link' });
      expect(button).toBeInTheDocument();
      expect(button).toBeDisabled();

      await user.click(button);
      expect(handleClick).not.toHaveBeenCalled();
    });

    it('falls back to disabled button and suppresses navigation/clicks when loading=true with href', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();

      render(
        <Button
          href="/tasks/123"
          loading
          loadingText="Loading Run..."
          aria-label="Loading Task Link"
          onClick={handleClick}
        >
          Run Link
        </Button>,
      );

      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      const button = screen.getByRole('button');
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-busy', 'true');
      expect(button).toHaveTextContent('Loading Run...');

      await user.click(button);
      expect(handleClick).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // 4. Boundary Token Contrast & Accessibility
  // ===========================================================================
  describe('Design Tokens & Accessibility (Axe)', () => {
    it('confirms --border-queued meets non-text contrast >= 3.0:1 on all surfaces', () => {
      // --border-queued: rgba(69, 198, 242, 0.50)
      const borderQueued: [number, number, number, number] = [69, 198, 242, 0.50];

      const contrastPanelInset = contrastRatioRgbaOverBg(borderQueued, '#080d16');
      expect(contrastPanelInset).toBeGreaterThanOrEqual(3.0);

      const contrastPanel = contrastRatioRgbaOverBg(borderQueued, '#0b111c');
      expect(contrastPanel).toBeGreaterThanOrEqual(3.0);

      const contrastBg = contrastRatioRgbaOverBg(borderQueued, '#06090f');
      expect(contrastBg).toBeGreaterThanOrEqual(3.0);
    });

    it('has zero accessibility violations across Card, Disclosure, and Button link', async () => {
      let results: Awaited<ReturnType<typeof axe>> | null = null;
      await act(async () => {
        const { container } = render(
          <div>
            {/* Pattern 1: Non-interactive Card container hosting interactive children */}
            <Card variant="panel" aria-label="Container Card">
              <CardHeader>
                <CardTitle>System Overview</CardTitle>
                <CardDescription>Execution metrics and diagnostics</CardDescription>
              </CardHeader>
              <CardBody>
                <Disclosure title="Raw Diagnostics" defaultOpen>
                  <p>Status: Healthy</p>
                </Disclosure>
              </CardBody>
              <CardFooter>
                <Button href="/settings" aria-label="Go to settings">
                  Settings
                </Button>
              </CardFooter>
            </Card>

            {/* Pattern 2: Interactive Card (role="button") with non-interactive content */}
            <Card interactive aria-label="Selectable Task Item">
              <CardHeader>
                <CardTitle>Task #42</CardTitle>
                <CardDescription>Research Brief Run</CardDescription>
              </CardHeader>
              <CardBody>
                <p>Completed in 1.2s</p>
              </CardBody>
            </Card>
          </div>,
        );
        results = await axe(container, axeComponentOptions);
      });

      expect(results).toHaveNoViolations();
    });
  });
});
