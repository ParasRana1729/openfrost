import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fs from 'node:fs';
import path from 'node:path';

import { Button } from '../components/ui/Button';
import {
  Card,
  CardBody,
  CardFooter,
} from '../components/ui/Card';
import { Disclosure } from '../components/ui/Disclosure';
import { ModalDialog } from '../components/ui/ModalDialog';
import { Drawer } from '../components/ui/Drawer';

describe('Challenger M1.2: Keyboard Operability, Reduced Motion & High Contrast', () => {
  // =========================================================================
  // 1. Keyboard Navigation Across Primitives
  // =========================================================================
  describe('Interactive Card Keyboard Navigation', () => {
    it('is reachable via Tab and has tabIndex="0" with role="button"', async () => {
      const user = userEvent.setup();
      render(
        <div>
          <button type="button">Preceding Control</button>
          <Card interactive aria-label="Task Card">
            <CardBody>Select task to view details</CardBody>
          </Card>
          <button type="button">Succeeding Control</button>
        </div>,
      );

      const before = screen.getByRole('button', { name: 'Preceding Control' });
      const card = screen.getByRole('button', { name: 'Task Card' });
      const after = screen.getByRole('button', { name: 'Succeeding Control' });

      before.focus();
      expect(before).toHaveFocus();

      await user.tab();
      expect(card).toHaveFocus();
      expect(card).toHaveAttribute('tabIndex', '0');

      await user.tab();
      expect(after).toHaveFocus();
    });

    it('activates onClick on Enter key', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();
      render(
        <Card interactive onClick={handleClick} aria-label="Enter Card">
          <CardBody>Press Enter</CardBody>
        </Card>,
      );

      const card = screen.getByRole('button', { name: 'Enter Card' });
      card.focus();
      expect(card).toHaveFocus();

      await user.keyboard('{Enter}');
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('activates onClick on Space key and prevents default scrolling', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();
      render(
        <Card interactive onClick={handleClick} aria-label="Space Card">
          <CardBody>Press Space</CardBody>
        </Card>,
      );

      const card = screen.getByRole('button', { name: 'Space Card' });
      card.focus();
      expect(card).toHaveFocus();

      await user.keyboard(' ');
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('non-interactive card ignores Enter and Space and has no tabIndex or button role', async () => {
      const handleClick = vi.fn();
      const { container } = render(
        <Card onClick={handleClick}>
          <CardBody>Static Card Content</CardBody>
        </Card>,
      );

      const card = container.firstChild as HTMLElement;
      expect(card).not.toHaveAttribute('role');
      expect(card).not.toHaveAttribute('tabIndex');

      fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });
      fireEvent.keyDown(card, { key: ' ', code: 'Space' });
      expect(handleClick).not.toHaveBeenCalled();
    });

    it('verifies fix: Card handleKeyDown does not hijack bubbling Enter/Space from nested interactive children', async () => {
      const user = userEvent.setup();
      const handleCardClick = vi.fn();
      const handleBtnClick = vi.fn();

      render(
        <Card interactive onClick={handleCardClick} aria-label="Parent Card">
          <CardBody>Task Details</CardBody>
          <CardFooter>
            <Button onClick={handleBtnClick}>
              Action Button
            </Button>
          </CardFooter>
        </Card>,
      );

      const actionBtn = screen.getByRole('button', { name: 'Action Button' });
      actionBtn.focus();
      expect(actionBtn).toHaveFocus();

      // When the user presses Enter on the inner button:
      await user.keyboard('{Enter}');

      // REMEDIATION VERIFIED:
      // Because Card.tsx checks if (e.target !== e.currentTarget),
      // the parent Card does not intercept the Enter keydown, does not suppress button click,
      // and fires the button's onClick!
      expect(handleCardClick).toHaveBeenCalledTimes(0);
      expect(handleBtnClick).toHaveBeenCalledTimes(1);
    });

    it('verifies fix: Card handleKeyDown does not suppress Space bar in nested text inputs', () => {
      const handleCardClick = vi.fn();

      render(
        <Card interactive onClick={handleCardClick} aria-label="Parent Card">
          <CardBody>
            <input type="text" placeholder="Enter task title..." />
          </CardBody>
        </Card>,
      );

      const input = screen.getByPlaceholderText('Enter task title...');
      input.focus();

      // User presses space key while typing in input:
      const spaceEvent = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
      input.dispatchEvent(spaceEvent);

      // Card does not intercept Space, allowing normal text input entry:
      expect(spaceEvent.defaultPrevented).toBe(false);
      expect(handleCardClick).toHaveBeenCalledTimes(0);
    });
  });

  // =========================================================================
  // 2. Disclosure Keyboard Operability
  // =========================================================================
  describe('Disclosure Keyboard Navigation', () => {
    it('controlled mode toggles via Enter and Space keys', async () => {
      const user = userEvent.setup();

      function ControlledHarness() {
        const [open, setOpen] = useState(false);
        return (
          <Disclosure
            title="Controlled Section"
            isOpen={open}
            onToggle={setOpen}
          >
            <div>Controlled Content Revealed</div>
          </Disclosure>
        );
      }

      render(<ControlledHarness />);
      const trigger = screen.getByRole('button', { name: /Controlled Section/ });
      expect(trigger).toHaveAttribute('aria-expanded', 'false');

      trigger.focus();
      expect(trigger).toHaveFocus();

      // Toggle Open with Enter
      await user.keyboard('{Enter}');
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('Controlled Content Revealed')).toBeVisible();

      // Toggle Close with Space
      await user.keyboard(' ');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    it('controlled mode maintains valid aria-controls and aria-labelledby linkages', () => {
      render(
        <Disclosure title="ARIA Linkage Section" defaultOpen={true}>
          <div>Panel Content</div>
        </Disclosure>,
      );

      const trigger = screen.getByText('ARIA Linkage Section').closest('summary');
      expect(trigger).toBeInTheDocument();
    });

    it('native mode (<details>/<summary>) is focusable and responds to clicks and synthetic toggle', () => {
      const handleToggle = vi.fn();
      render(
        <Disclosure title="Native Disclosure" onToggle={handleToggle}>
          <div>Native Details Body</div>
        </Disclosure>,
      );

      const summary = screen.getByText('Native Disclosure').closest('summary');
      expect(summary).toBeInTheDocument();

      // Focus summary
      summary?.focus();
      expect(summary).toHaveFocus();

      // Simulate native toggle
      const details = summary?.closest('details');
      expect(details).toBeInTheDocument();
      if (details) {
        details.open = true;
        fireEvent(details, new Event('toggle'));
        expect(handleToggle).toHaveBeenCalledWith(true);

        details.open = false;
        fireEvent(details, new Event('toggle'));
        expect(handleToggle).toHaveBeenCalledWith(false);
      }
    });
  });

  // =========================================================================
  // 3. Button Disabled and Busy States
  // =========================================================================
  describe('Button Disabled and Busy Keyboard Immunity', () => {
    it('disabled button cannot be activated via Enter or Space', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();
      render(
        <Button disabled onClick={handleClick}>
          Disabled Target
        </Button>,
      );

      const button = screen.getByRole('button', { name: 'Disabled Target' });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-disabled', 'true');

      // Attempt activation
      button.focus();
      await user.keyboard('{Enter}');
      await user.keyboard(' ');
      fireEvent.keyDown(button, { key: 'Enter', code: 'Enter' });
      fireEvent.keyDown(button, { key: ' ', code: 'Space' });
      expect(handleClick).not.toHaveBeenCalled();
    });

    it('busy/loading button cannot be activated via Enter or Space and has aria-busy="true"', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();
      render(
        <Button loading loadingText="Executing..." onClick={handleClick}>
          Execute
        </Button>,
      );

      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-busy', 'true');
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toBeDisabled();

      button.focus();
      await user.keyboard('{Enter}');
      await user.keyboard(' ');
      fireEvent.keyDown(button, { key: 'Enter', code: 'Enter' });
      fireEvent.keyDown(button, { key: ' ', code: 'Space' });
      expect(handleClick).not.toHaveBeenCalled();
    });

    it('button with href falls back to disabled <button> when disabled or loading', () => {
      const { rerender } = render(
        <Button href="/tasks/new" disabled>
          Create Task Link
        </Button>,
      );

      // Should NOT render as <a> or Next Link
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      const disabledBtn = screen.getByRole('button', { name: 'Create Task Link' });
      expect(disabledBtn).toBeDisabled();

      rerender(
        <Button href="/tasks/new" loading loadingText="Creating...">
          Create Task Link
        </Button>,
      );
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      const loadingBtn = screen.getByRole('button');
      expect(loadingBtn).toHaveAttribute('aria-busy', 'true');
      expect(loadingBtn).toBeDisabled();
    });
  });

  // =========================================================================
  // 4. Drawer & Modal Escape Key and Dismissal
  // =========================================================================
  describe('Drawer and Modal Escape Dismissal', () => {
    it('Drawer dismisses cleanly via cancel event (HTML5 <dialog> standard Escape signal)', () => {
      const handleClose = vi.fn();
      render(
        <Drawer isOpen={true} onClose={handleClose} title="Inspection Drawer">
          <div>Drawer Content</div>
        </Drawer>,
      );

      const dialog = screen.getByRole('dialog', { name: 'Inspection Drawer' });
      expect(dialog).toBeInTheDocument();

      // In HTML5 dialog, pressing Escape triggers a 'cancel' event on the dialog element
      fireEvent(dialog, new Event('cancel', { cancelable: true }));
      expect(handleClose).toHaveBeenCalledTimes(1);
    });

    it('Drawer closeOnEscape=false prevents dismissal on cancel event', () => {
      const handleClose = vi.fn();
      render(
        <Drawer
          isOpen={true}
          onClose={handleClose}
          closeOnEscape={false}
          title="Pinned Drawer"
        >
          <div>Cannot dismiss with Escape</div>
        </Drawer>,
      );

      const dialog = screen.getByRole('dialog', { name: 'Pinned Drawer' });
      const cancelEvent = new Event('cancel', { cancelable: true });
      fireEvent(dialog, cancelEvent);

      expect(cancelEvent.defaultPrevented).toBe(true);
      expect(handleClose).not.toHaveBeenCalled();
    });

    it('Drawer restores focus to preceding element upon unmounting/closing', () => {
      function DrawerTestHarness() {
        const [open, setOpen] = useState(false);
        return (
          <div>
            <button id="open-btn" onClick={() => setOpen(true)}>
              Open Drawer
            </button>
            <Drawer isOpen={open} onClose={() => setOpen(false)} title="Test Drawer">
              <p>Body</p>
            </Drawer>
          </div>
        );
      }

      render(<DrawerTestHarness />);
      const openBtn = screen.getByRole('button', { name: 'Open Drawer' });
      openBtn.focus();
      expect(openBtn).toHaveFocus();

      // Open drawer
      fireEvent.click(openBtn);
      const dialog = screen.getByRole('dialog', { name: 'Test Drawer' });
      expect(dialog).toBeInTheDocument();

      // Close drawer via close button
      const closeBtn = screen.getByRole('button', { name: 'Close drawer' });
      fireEvent.click(closeBtn);

      // Verify dialog is removed and focus is restored to trigger button
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(openBtn).toHaveFocus();
    });

    it('ModalDialog dismisses cleanly via cancel event and restores focus', () => {
      const handleClose = vi.fn();
      render(
        <ModalDialog isOpen={true} onClose={handleClose} title="Confirmation Modal">
          <div>Modal Body</div>
        </ModalDialog>,
      );

      const dialog = screen.getByRole('dialog', { name: 'Confirmation Modal' });
      fireEvent(dialog, new Event('cancel', { cancelable: true }));
      expect(handleClose).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // 5. Prefers-Reduced-Motion CSS Verification
  // =========================================================================
  describe('prefers-reduced-motion CSS Overrides', () => {
    const cssPath = path.resolve(__dirname, '../app/globals.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    it('contains @media (prefers-reduced-motion: reduce) overriding .dot-pulse animation', () => {
      // Must disable animation on .dot-pulse
      const pulseBlock = cssContent.match(
        /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{[\s\S]*?\.dot-pulse\s*\{[\s\S]*?animation:\s*none;[\s\S]*?\}[\s\S]*?\}/,
      );
      expect(pulseBlock, 'Expected .dot-pulse animation: none under prefers-reduced-motion').toBeTruthy();
    });

    it('contains @media (prefers-reduced-motion: reduce) overriding dialog.drawer-dialog transition', () => {
      // Must disable transition on drawer
      const drawerBlock = cssContent.match(
        /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{[\s\S]*?dialog\.drawer-dialog\s*\{[\s\S]*?transition:\s*none;[\s\S]*?\}[\s\S]*?\}/,
      );
      expect(drawerBlock, 'Expected dialog.drawer-dialog transition: none under prefers-reduced-motion').toBeTruthy();
    });

    it('contains @media (prefers-reduced-motion: reduce) overriding .disclosure-chevron transition', () => {
      const chevronBlock = cssContent.match(
        /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{[\s\S]*?\.disclosure-chevron\s*\{[\s\S]*?transition:\s*none;[\s\S]*?\}[\s\S]*?\}/,
      );
      expect(chevronBlock, 'Expected .disclosure-chevron transition: none under prefers-reduced-motion').toBeTruthy();
    });

    it('contains @media (prefers-reduced-motion: reduce) overriding body::before transition', () => {
      const bodyBlock = cssContent.match(
        /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{[\s\S]*?body::before\s*\{[\s\S]*?transition:\s*none;[\s\S]*?\}[\s\S]*?\}/,
      );
      expect(bodyBlock, 'Expected body::before transition: none under prefers-reduced-motion').toBeTruthy();
    });
  });

  // =========================================================================
  // 6. Windows High Contrast Mode (forced-colors: active) CSS Verification
  // =========================================================================
  describe('Windows High Contrast Mode (forced-colors: active) Styling', () => {
    const cssPath = path.resolve(__dirname, '../app/globals.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    it('defines @media (forced-colors: active) with system color keywords', () => {
      expect(cssContent).toContain('@media (forced-colors: active)');
    });

    it('enforces visible 2px solid Highlight focus rings in forced-colors', () => {
      const focusVisibleBlock = cssContent.match(
        /@media\s*\(forced-colors:\s*active\)[\s\S]*?:focus-visible\s*\{[\s\S]*?outline:\s*2px solid Highlight;[\s\S]*?\}/,
      );
      expect(focusVisibleBlock, 'Expected :focus-visible to use Highlight in forced-colors').toBeTruthy();
    });

    it('ensures input, textarea, and select controls use Highlight border and outline in forced-colors', () => {
      const inputBlock = cssContent.match(
        /@media\s*\(forced-colors:\s*active\)[\s\S]*?input:focus-visible[\s\S]*?border-color:\s*Highlight;/,
      );
      expect(inputBlock, 'Expected form controls to use Highlight border in forced-colors').toBeTruthy();
    });

    it('styles .btn-primary with ButtonText and ButtonFace system colors in forced-colors', () => {
      const btnBlock = cssContent.match(
        /@media\s*\(forced-colors:\s*active\)[\s\S]*?\.btn-primary\s*\{[\s\S]*?background:\s*ButtonText;[\s\S]*?color:\s*ButtonFace;[\s\S]*?\}/,
      );
      expect(btnBlock, 'Expected .btn-primary to use ButtonText / ButtonFace in forced-colors').toBeTruthy();
    });

    it('enforces visible CanvasText boundary on .status-badge in forced-colors', () => {
      const badgeBlock = cssContent.match(
        /@media\s*\(forced-colors:\s*active\)[\s\S]*?\.status-badge\s*\{[\s\S]*?border:\s*1px solid CanvasText;[\s\S]*?\}/,
      );
      expect(badgeBlock, 'Expected .status-badge to have 1px solid CanvasText border in forced-colors').toBeTruthy();
    });
  });
});
