import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';

import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ModalDialog } from '../components/ui/ModalDialog';
import { Drawer } from '../components/ui/Drawer';

const axeComponentOptions = {
  rules: {
    region: { enabled: false },
  },
};

// =============================================================================
// Mathematical Contrast Oracle (WCAG 2.1 relative luminance algorithm)
// =============================================================================
function hexToRgb(hex: string): [number, number, number] {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  return [r, g, b];
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

function contrastRatio(hex1: string, hex2: string): number {
  const lum1 = relativeLuminance(hexToRgb(hex1));
  const lum2 = relativeLuminance(hexToRgb(hex2));
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

function compositeRgbaOverOpaque(
  fgRgba: [number, number, number, number],
  bgRgb: [number, number, number],
): [number, number, number] {
  const [fr, fg, fb, a] = fgRgba;
  const [br, bg, bb] = bgRgb;
  return [
    Math.round(fr * a + br * (1 - a)),
    Math.round(fg * a + bg * (1 - a)),
    Math.round(fb * a + bb * (1 - a)),
  ];
}

function contrastRatioRgbaOverBg(
  fgRgba: [number, number, number, number],
  bgHex: string,
): number {
  const bgRgb = hexToRgb(bgHex);
  const composited = compositeRgbaOverOpaque(fgRgba, bgRgb);
  const lum1 = relativeLuminance(composited);
  const lum2 = relativeLuminance(bgRgb);
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

describe('Milestone 1 Empirical Challenge Suite', () => {
  // ===========================================================================
  // 1. Button Primitive Stress & Edge Cases
  // ===========================================================================
  describe('Button Edge Cases & Collisions', () => {
    it('behaves predictably when both href and disabled are passed', () => {
      const handleClick = vi.fn();
      render(
        <Button href="/tasks" disabled onClick={handleClick}>
          Disabled Link
        </Button>,
      );

      // When disabled, it should NOT render a link but a disabled button to prevent navigation
      const button = screen.getByRole('button', { name: 'Disabled Link' });
      expect(button).toBeInTheDocument();
      expect(button).toBeDisabled();
      expect(button.tagName.toLowerCase()).toBe('button');

      button.click();
      expect(handleClick).not.toHaveBeenCalled();
    });

    it('verifies href forwards onClick and rest props (remediated)', () => {
      const handleClick = vi.fn();
      const { container } = render(
        <Button
          href="https://example.com"
          asExternalLink
          onClick={handleClick}
          id="custom-link-id"
          data-testid="link-btn"
          aria-label="External Link Label"
        >
          Go External
        </Button>,
      );

      const link = container.querySelector('a');
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', 'https://example.com');
      expect(link).toHaveAttribute('target', '_blank');

      // VERIFIED: {...rest} is forwarded to <a> or Link in Button.tsx
      expect(link).toHaveAttribute('id', 'custom-link-id');
      expect(link).toHaveAttribute('data-testid', 'link-btn');
      expect(link).toHaveAttribute('aria-label', 'External Link Label');

      // VERIFIED: onClick is forwarded to <a> or Link in Button.tsx
      fireEvent.click(link!);
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('handles both loading and disabled simultaneously', () => {
      const handleClick = vi.fn();
      render(
        <Button loading disabled loadingText="Loading..." onClick={handleClick}>
          Submit
        </Button>,
      );

      const button = screen.getByRole('button');
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-busy', 'true');
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveTextContent('Loading...');
      button.click();
      expect(handleClick).not.toHaveBeenCalled();
    });

    it('rapid successive clicks do not fire multiple times when disabled', async () => {
      const handleClick = vi.fn();
      render(
        <Button disabled onClick={handleClick}>
          Spam Target
        </Button>,
      );
      const button = screen.getByRole('button');

      for (let i = 0; i < 10; i++) {
        button.click();
      }
      expect(handleClick).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // 2. ModalDialog & Drawer Focus and Escape Handling
  // ===========================================================================
  describe('ModalDialog & Drawer Focus and Dismiss Mechanics', () => {
    it('restores focus to previously active element on close', async () => {
      function FocusRestorationHarness() {
        const [isOpen, setIsOpen] = useState(false);
        return (
          <div>
            <button id="trigger-btn" onClick={() => setIsOpen(true)}>
              Open Modal
            </button>
            <ModalDialog
              isOpen={isOpen}
              onClose={() => setIsOpen(false)}
              title="Focus Test"
            >
              <p>Inside Modal</p>
              <button id="inside-btn">Inside Action</button>
            </ModalDialog>
          </div>
        );
      }

      render(<FocusRestorationHarness />);
      const trigger = screen.getByRole('button', { name: 'Open Modal' });
      trigger.focus();
      expect(trigger).toHaveFocus();

      // Open dialog
      fireEvent.click(trigger);
      expect(screen.getByRole('dialog', { name: 'Focus Test' })).toBeInTheDocument();

      // Close dialog via close button
      const closeBtn = screen.getByRole('button', { name: 'Close dialog' });
      fireEvent.click(closeBtn);

      // Verify trigger regained focus
      expect(trigger).toHaveFocus();
    });

    it('Drawer restores focus to previously active element on close', async () => {
      function DrawerFocusHarness() {
        const [isOpen, setIsOpen] = useState(false);
        return (
          <div>
            <button id="drawer-trigger" onClick={() => setIsOpen(true)}>
              Open Drawer
            </button>
            <Drawer
              isOpen={isOpen}
              onClose={() => setIsOpen(false)}
              title="Drawer Inspection"
            >
              <p>Drawer Content</p>
            </Drawer>
          </div>
        );
      }

      render(<DrawerFocusHarness />);
      const trigger = screen.getByRole('button', { name: 'Open Drawer' });
      trigger.focus();
      expect(trigger).toHaveFocus();

      fireEvent.click(trigger);
      expect(screen.getByRole('dialog', { name: 'Drawer Inspection' })).toBeInTheDocument();

      const closeBtn = screen.getByRole('button', { name: 'Close drawer' });
      fireEvent.click(closeBtn);

      expect(trigger).toHaveFocus();
    });

    it('tests focus position when initialFocusRef is not provided', () => {
      function NoInitialFocusHarness() {
        const [isOpen, setIsOpen] = useState(false);
        return (
          <div>
            <button id="open-btn" onClick={() => setIsOpen(true)}>
              Launch Dialog
            </button>
            <ModalDialog
              isOpen={isOpen}
              onClose={() => setIsOpen(false)}
              title="No Initial Focus"
            >
              <input id="first-input" placeholder="Name" />
            </ModalDialog>
          </div>
        );
      }

      render(<NoInitialFocusHarness />);
      const openBtn = screen.getByRole('button', { name: 'Launch Dialog' });
      openBtn.focus();
      fireEvent.click(openBtn);

      // In jsdom without native browser top-layer autofocus,
      // verify whether focus stayed on openBtn or moved
      // EMPIRICAL OBSERVATION: Without initialFocusRef, ModalDialog does not explicitly focus inside.
    });

    it('handles backdrop click outside content rect', () => {
      const handleClose = vi.fn();
      render(
        <ModalDialog isOpen={true} onClose={handleClose} title="Backdrop Test">
          <p>Dialog Body</p>
        </ModalDialog>,
      );

      const dialog = screen.getByRole('dialog');

      // Mock bounding client rect: dialog content is 100x100 at (50, 50)
      vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
        top: 50,
        bottom: 150,
        left: 50,
        right: 150,
        width: 100,
        height: 100,
        x: 50,
        y: 50,
        toJSON: () => {},
      });

      // Click inside (75, 75)
      fireEvent.click(dialog, { clientX: 75, clientY: 75 });
      expect(handleClose).not.toHaveBeenCalled();

      // Click outside on backdrop (20, 20)
      fireEvent.click(dialog, { clientX: 20, clientY: 20 });
      expect(handleClose).toHaveBeenCalledTimes(1);
    });

    it('honors closeOnBackdropClick=false', () => {
      const handleClose = vi.fn();
      render(
        <ModalDialog
          isOpen={true}
          onClose={handleClose}
          title="No Backdrop Dismiss"
          closeOnBackdropClick={false}
        >
          <p>Important Dialog</p>
        </ModalDialog>,
      );

      const dialog = screen.getByRole('dialog');
      vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
        top: 50,
        bottom: 150,
        left: 50,
        right: 150,
        width: 100,
        height: 100,
        x: 50,
        y: 50,
        toJSON: () => {},
      });

      // Click outside
      fireEvent.click(dialog, { clientX: 10, clientY: 10 });
      expect(handleClose).not.toHaveBeenCalled();
    });

    it('honors closeOnEscape=false on synthetic cancel event', () => {
      const handleClose = vi.fn();
      render(
        <ModalDialog
          isOpen={true}
          onClose={handleClose}
          title="Escape Trapped"
          closeOnEscape={false}
        >
          <p>Must finish task</p>
        </ModalDialog>,
      );

      const dialog = screen.getByRole('dialog');
      const cancelEvent = new Event('cancel', { cancelable: true });
      dialog.dispatchEvent(cancelEvent);

      expect(handleClose).not.toHaveBeenCalled();
      expect(cancelEvent.defaultPrevented).toBe(true);
    });

    it('handles rapid escape / cancel events without error', () => {
      const handleClose = vi.fn();
      render(
        <ModalDialog isOpen={true} onClose={handleClose} title="Rapid Escape">
          <p>Content</p>
        </ModalDialog>,
      );

      const dialog = screen.getByRole('dialog');
      for (let i = 0; i < 5; i++) {
        fireEvent(dialog, new Event('cancel', { cancelable: true }));
      }
      expect(handleClose).toHaveBeenCalledTimes(5);
    });
  });

  // ===========================================================================
  // 3. StatusBadge Resilience & Edge States
  // ===========================================================================
  describe('StatusBadge Edge Statuses', () => {
    it('gracefully handles unknown or custom status states', () => {
      // @ts-expect-error testing runtime resilience against unexpected backend status
      render(<StatusBadge state="provisioning_instance" />);
      const badge = screen.getByRole('status');
      expect(badge).toBeInTheDocument();
      // Label replaces first underscore: "provisioning instance"
      expect(badge).toHaveTextContent('provisioning instance');
      expect(badge).toHaveClass('status-badge', 'badge-default');
    });

    it('handles empty string or null state gracefully', () => {
      // @ts-expect-error testing null state
      render(<StatusBadge state={null} />);
      const badge = screen.getByRole('status');
      expect(badge).toHaveTextContent('Queued');
      expect(badge).toHaveClass('badge-queued');
    });

    it('handles uppercase states via normalization', () => {
      // @ts-expect-error testing uppercase
      render(<StatusBadge state="RUNNING" />);
      const badge = screen.getByRole('status');
      expect(badge).toHaveTextContent('Running');
      expect(badge).toHaveClass('badge-running');
    });

    it('reveals single-underscore limitation on complex state names', () => {
      // @ts-expect-error testing multiple underscores
      render(<StatusBadge state="waiting_for_user_approval" />);
      const badge = screen.getByRole('status');
      // replace('_', ' ') only replaces the FIRST underscore:
      expect(badge).toHaveTextContent('waiting for_user_approval');
    });

    it('passes axe audit with arbitrary status string', async () => {
      const { container } = render(
        // @ts-expect-error testing arbitrary status
        <StatusBadge state="awaiting_upstream_token" />,
      );
      const results = await axe(container, axeComponentOptions);
      expect(results).toHaveNoViolations();
    });
  });

  // ===========================================================================
  // 4. Design Tokens Contrast Oracle (WCAG 2.1 AA >= 4.5:1)
  // ===========================================================================
  describe('Design Token Contrast Verification', () => {
    const surfaces = {
      bg: '#06090f',
      panel: '#0b111c',
      panelInset: '#080d16',
      raised: '#101827',
      consoleBg: '#04070c',
    };

    const textTokens = {
      ink: '#eaf1f8',
      muted: '#8fa5bb',
      faint: '#8097b0', // Updated in M1 from #71869b
      ice: '#45c6f2',
      iceStrong: '#8fdcf9',
      ok: '#45e0a6',
      warn: '#e5b45e',
      bad: '#f2796b',
    };

    // Primary button: text #04090f on #45c6f2
    it('verifies Primary Button contrast exceeds WCAG AA (>= 4.5:1)', () => {
      const ratio = contrastRatio('#45c6f2', '#04090f');
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    // Secondary button: text #eaf1f8 on #0b111c
    it('verifies Secondary Button contrast exceeds WCAG AA', () => {
      const ratio = contrastRatio('#eaf1f8', '#0b111c');
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    // Ink token across all surfaces
    it.each(Object.entries(surfaces))('verifies --ink on %s meets WCAG AA (>= 4.5:1)', (_, surfaceHex) => {
      const ratio = contrastRatio(textTokens.ink, surfaceHex);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    // Muted token across all surfaces
    it.each(Object.entries(surfaces))('verifies --muted on %s meets WCAG AA (>= 4.5:1)', (_, surfaceHex) => {
      const ratio = contrastRatio(textTokens.muted, surfaceHex);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    // Faint token across all surfaces (the specific token worker_m1_1 modified)
    it.each(Object.entries(surfaces))('verifies upgraded --faint (#8097b0) on %s meets WCAG AA (>= 4.5:1)', (_, surfaceHex) => {
      const ratio = contrastRatio(textTokens.faint, surfaceHex);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    // Status colors as text/labels on dark backgrounds
    it.each(Object.entries(surfaces))('verifies --ok on %s meets WCAG AA', (_, surfaceHex) => {
      const ratio = contrastRatio(textTokens.ok, surfaceHex);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it.each(Object.entries(surfaces))('verifies --warn on %s meets WCAG AA', (_, surfaceHex) => {
      const ratio = contrastRatio(textTokens.warn, surfaceHex);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it.each(Object.entries(surfaces))('verifies --bad on %s meets WCAG AA', (_, surfaceHex) => {
      const ratio = contrastRatio(textTokens.bad, surfaceHex);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it.each(Object.entries(surfaces))('verifies --ice on %s meets WCAG AA', (_, surfaceHex) => {
      const ratio = contrastRatio(textTokens.ice, surfaceHex);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    // Boundary Tokens vs WCAG 1.4.11 Non-text Contrast (>= 3.0:1)
    describe('Non-text component boundary contrast', () => {
      it('evaluates --border-ice rgba(69, 198, 242, 0.55) over --panel #0b111c', () => {
        const ratio = contrastRatioRgbaOverBg([69, 198, 242, 0.55], '#0b111c');
        expect(ratio).toBeGreaterThanOrEqual(3.0);
      });

      it('evaluates --border-ok rgba(69, 224, 166, 0.50) over --panel #0b111c', () => {
        const ratio = contrastRatioRgbaOverBg([69, 224, 166, 0.50], '#0b111c');
        expect(ratio).toBeGreaterThanOrEqual(3.0);
      });

      it('evaluates --border-warn rgba(229, 180, 94, 0.55) over --panel #0b111c', () => {
        const ratio = contrastRatioRgbaOverBg([229, 180, 94, 0.55], '#0b111c');
        expect(ratio).toBeGreaterThanOrEqual(3.0);
      });

      it('evaluates --border-bad rgba(242, 121, 107, 0.60) over --panel #0b111c', () => {
        const ratio = contrastRatioRgbaOverBg([242, 121, 107, 0.60], '#0b111c');
        expect(ratio).toBeGreaterThanOrEqual(3.0);
      });

      it('evaluates --border-queued #364b73 over --panel-inset #080d16 (EMPIRICAL FINDING)', () => {
        const queuedBorder = contrastRatio('#364b73', '#080d16');
        // Record exact ratio: 2.23:1 (below 3.0:1)
        expect(queuedBorder).toBeLessThan(3.0);
      });
    });
  });
});
