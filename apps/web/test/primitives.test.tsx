import React, { createRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';

import { Button } from '../components/ui/Button';
import { StatusBadge, type HumanStatus } from '../components/ui/StatusBadge';
import {
  Card,
  CardBody,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../components/ui/Card';
import { Disclosure } from '../components/ui/Disclosure';
import { ModalDialog } from '../components/ui/ModalDialog';
import { Drawer } from '../components/ui/Drawer';

// Helper options for axe in component unit testing:
// In isolated component tests without full document wrappers,
// disable document-level landmark/region requirements.
const axeComponentOptions = {
  rules: {
    region: { enabled: false },
  },
};

describe('Accessible UI Primitives', () => {
  // =========================================================================
  // 1. Button Primitive
  // =========================================================================
  describe('Button', () => {
    it('renders with default type="button" and secondary variant', () => {
      render(<Button>Execute Step</Button>);
      const button = screen.getByRole('button', { name: 'Execute Step' });
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute('type', 'button');
      expect(button).toHaveClass('btn', 'btn-secondary', 'btn-md');
    });

    it('renders all variants and sizes', () => {
      const { rerender } = render(
        <Button variant="primary" size="sm">
          Submit
        </Button>,
      );
      expect(screen.getByRole('button')).toHaveClass('btn-primary', 'btn-sm');

      rerender(<Button variant="danger">Delete</Button>);
      expect(screen.getByRole('button')).toHaveClass('btn-danger');

      rerender(<Button variant="ghost">Cancel</Button>);
      expect(screen.getByRole('button')).toHaveClass('btn-ghost');
    });

    it('handles disabled state properly', () => {
      const handleClick = vi.fn();
      render(
        <Button disabled onClick={handleClick}>
          Disabled Action
        </Button>,
      );
      const button = screen.getByRole('button');
      expect(button).toBeDisabled();
      button.click();
      expect(handleClick).not.toHaveBeenCalled();
    });

    it('handles loading state with aria-busy and prevents activation', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();
      render(
        <Button loading loadingText="Deploying..." onClick={handleClick}>
          Deploy
        </Button>,
      );
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-busy', 'true');
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveTextContent('Deploying...');

      await user.click(button);
      expect(handleClick).not.toHaveBeenCalled();
    });

    it('triggers click handler via keyboard (Enter and Space)', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();
      render(<Button onClick={handleClick}>Keyboard Target</Button>);
      const button = screen.getByRole('button', { name: 'Keyboard Target' });

      button.focus();
      expect(button).toHaveFocus();

      await user.keyboard('{Enter}');
      expect(handleClick).toHaveBeenCalledTimes(1);

      await user.keyboard(' ');
      expect(handleClick).toHaveBeenCalledTimes(2);
    });

    it('forwards aria-label, onClick, and custom attributes when href is provided', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn((e: React.MouseEvent) => {
        e.preventDefault();
      });

      render(
        <Button
          href="/tasks/new"
          aria-label="Create new agent task"
          data-testid="link-button"
          onClick={handleClick}
        >
          New Task
        </Button>,
      );

      const link = screen.getByRole('link', { name: 'Create new agent task' });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', '/tasks/new');
      expect(link).toHaveAttribute('data-testid', 'link-button');

      await user.click(link);
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('has zero accessibility violations (axe)', async () => {
      const { container } = render(
        <div>
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="ghost">Ghost</Button>
          <Button loading loadingText="Processing...">
            Process
          </Button>
        </div>,
      );
      const results = await axe(container, axeComponentOptions);
      expect(results).toHaveNoViolations();
    });
  });

  // =========================================================================
  // 2. StatusBadge Primitive
  // =========================================================================
  describe('StatusBadge', () => {
    it.each([
      ['queued', 'Queued', 'badge-queued'],
      ['running', 'Running', 'badge-running'],
      ['completed', 'Done', 'badge-completed'],
      ['done', 'Done', 'badge-completed'],
      ['failed', 'Failed', 'badge-failed'],
      ['awaiting_approval', 'Needs Approval', 'badge-awaiting-approval'],
      ['canceled', 'Canceled', 'badge-canceled'],
      ['interrupted', 'Interrupted', 'badge-interrupted'],
    ])('maps state "%s" to label "%s" and class "%s"', (state, expectedLabel, expectedClass) => {
      render(<StatusBadge state={state as HumanStatus} />);
      const badge = screen.getByRole('status');
      expect(badge).toHaveTextContent(expectedLabel);
      expect(badge).toHaveClass('status-badge', expectedClass);
      expect(badge).toHaveAttribute('aria-label', `Status: ${expectedLabel}`);
    });

    it('renders pulse dot for running state', () => {
      const { container } = render(<StatusBadge state="running" />);
      const dot = container.querySelector('.dot-pulse');
      expect(dot).toBeInTheDocument();
      expect(dot).toHaveAttribute('aria-hidden', 'true');
    });

    it('supports custom label override', () => {
      render(<StatusBadge state="failed" labelOverride="Timed Out" />);
      expect(screen.getByRole('status')).toHaveTextContent('Timed Out');
      expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Status: Timed Out');
    });

    it('has zero accessibility violations across all states (axe)', async () => {
      const { container } = render(
        <div>
          <StatusBadge state="queued" />
          <StatusBadge state="running" />
          <StatusBadge state="completed" />
          <StatusBadge state="failed" />
          <StatusBadge state="awaiting_approval" />
          <StatusBadge state="canceled" />
          <StatusBadge state="interrupted" />
        </div>,
      );
      const results = await axe(container, axeComponentOptions);
      expect(results).toHaveNoViolations();
    });
  });

  // =========================================================================
  // 3. Card Primitive
  // =========================================================================
  describe('Card', () => {
    it('renders compound structure with header, title accent, body, and footer', () => {
      render(
        <Card variant="panel">
          <CardHeader>
            <CardTitle accent>Project Alpha</CardTitle>
            <CardDescription>Main workspace directory</CardDescription>
          </CardHeader>
          <CardBody>
            <p>Artifact content and status summary.</p>
          </CardBody>
          <CardFooter>
            <Button size="sm">Inspect</Button>
          </CardFooter>
        </Card>,
      );

      expect(screen.getByText('Project Alpha')).toBeInTheDocument();
      expect(screen.getByText('Main workspace directory')).toBeInTheDocument();
      expect(screen.getByText('Artifact content and status summary.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Inspect' })).toBeInTheDocument();
    });

    it('supports interactive card with keyboard activation (Enter and Space)', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();
      render(
        <Card interactive onClick={handleClick} aria-label="Interactive Task Row">
          <CardBody>Select task to view details</CardBody>
        </Card>,
      );

      const card = screen.getByRole('button', { name: 'Interactive Task Row' });
      expect(card).toHaveAttribute('tabIndex', '0');

      card.focus();
      expect(card).toHaveFocus();

      await user.keyboard('{Enter}');
      expect(handleClick).toHaveBeenCalledTimes(1);

      await user.keyboard(' ');
      expect(handleClick).toHaveBeenCalledTimes(2);
    });

    it('allows Space key typing in nested input without triggering card onClick', () => {
      const handleCardClick = vi.fn();
      render(
        <Card interactive onClick={handleCardClick} aria-label="Task Card">
          <CardBody>
            <input type="text" placeholder="Enter task title..." />
          </CardBody>
        </Card>,
      );

      const input = screen.getByPlaceholderText('Enter task title...');
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

    it('triggers child button onClick on Enter key without triggering card onClick', async () => {
      const user = userEvent.setup();
      const handleCardClick = vi.fn();
      const handleButtonClick = vi.fn();

      render(
        <Card interactive onClick={handleCardClick} aria-label="Container Card">
          <CardBody>Task Details</CardBody>
          <CardFooter>
            <Button onClick={handleButtonClick}>Child Action</Button>
          </CardFooter>
        </Card>,
      );

      const childButton = screen.getByRole('button', { name: 'Child Action' });
      childButton.focus();
      expect(childButton).toHaveFocus();

      await user.keyboard('{Enter}');

      expect(handleButtonClick).toHaveBeenCalledTimes(1);
      expect(handleCardClick).not.toHaveBeenCalled();
    });

    it('has zero accessibility violations (axe)', async () => {
      const { container } = render(
        <Card variant="raised">
          <CardHeader>
            <CardTitle>System Run Diagnostics</CardTitle>
            <CardDescription>Step-level execution trace</CardDescription>
          </CardHeader>
          <CardBody>
            <p>All tool executions completed within limits.</p>
          </CardBody>
        </Card>,
      );
      const results = await axe(container, axeComponentOptions);
      expect(results).toHaveNoViolations();
    });
  });

  // =========================================================================
  // 4. Disclosure Primitive
  // =========================================================================
  describe('Disclosure', () => {
    it('renders in native mode (<details>/<summary>) and toggles open state on summary click', async () => {
      const user = userEvent.setup();
      const handleToggle = vi.fn();

      render(
        <Disclosure title="Raw Event Log" onToggle={handleToggle}>
          <pre>{JSON.stringify({ event: 'task.completed' })}</pre>
        </Disclosure>,
      );

      const summary = screen.getByText('Raw Event Log');
      const details = summary.closest('details') as HTMLDetailsElement;
      expect(details).toBeInTheDocument();
      expect(details.open).toBe(false);
      expect(screen.getByText(/task\.completed/)).toBeInTheDocument();

      await user.click(summary);
      expect(details.open).toBe(true);
      expect(handleToggle).toHaveBeenCalledWith(true);

      await user.click(summary);
      expect(details.open).toBe(false);
      expect(handleToggle).toHaveBeenCalledWith(false);
    });

    it('renders in controlled ARIA mode with button, aria-expanded, and aria-controls', async () => {
      const user = userEvent.setup();

      function ControlledHarness() {
        const [isOpen, setIsOpen] = useState(false);
        return (
          <Disclosure
            title="Execution Trace"
            isOpen={isOpen}
            onToggle={setIsOpen}
            headingLevel="h3"
          >
            <div>Trace information goes here.</div>
          </Disclosure>
        );
      }

      render(<ControlledHarness />);
      const trigger = screen.getByRole('button', { name: /Execution Trace/ });
      expect(trigger).toHaveAttribute('aria-expanded', 'false');

      const panelId = trigger.getAttribute('aria-controls');
      expect(panelId).toBeTruthy();

      await user.click(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('Trace information goes here.')).toBeVisible();
    });

    it('has zero accessibility violations (axe)', async () => {
      const { container } = render(
        <Disclosure title="Task Configuration" defaultOpen>
          <p>Bounded memory settings and provider models.</p>
        </Disclosure>,
      );
      const results = await axe(container, axeComponentOptions);
      expect(results).toHaveNoViolations();
    });
  });

  // =========================================================================
  // 5. ModalDialog Primitive
  // =========================================================================
  describe('ModalDialog', () => {
    it('renders native <dialog> element with accessible labels when open', () => {
      render(
        <ModalDialog
          isOpen={true}
          onClose={vi.fn()}
          title="Create New Task"
          description="Submit a prompt to start an agent execution."
        >
          <p>Dialog body content</p>
        </ModalDialog>,
      );

      const dialog = screen.getByRole('dialog', { name: 'Create New Task' });
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(screen.getByText('Dialog body content')).toBeInTheDocument();
    });

    it('delegates focus to initialFocusRef when specified', () => {
      function DialogWithFocusRef() {
        const inputRef = createRef<HTMLInputElement>();
        return (
          <ModalDialog
            isOpen={true}
            onClose={vi.fn()}
            title="Search Workspace"
            initialFocusRef={inputRef}
          >
            <input ref={inputRef} placeholder="Search query..." />
          </ModalDialog>
        );
      }

      render(<DialogWithFocusRef />);
      const input = screen.getByPlaceholderText('Search query...');
      expect(input).toHaveFocus();
    });

    it('calls onClose when close button is clicked', async () => {
      const user = userEvent.setup();
      const handleClose = vi.fn();

      render(
        <ModalDialog isOpen={true} onClose={handleClose} title="Notification Settings">
          <p>Configure notifications.</p>
        </ModalDialog>,
      );

      const closeBtn = screen.getByRole('button', { name: 'Close dialog' });
      await user.click(closeBtn);
      expect(handleClose).toHaveBeenCalledTimes(1);
    });

    it('has zero accessibility violations when open (axe)', async () => {
      const { container } = render(
        <ModalDialog
          isOpen={true}
          onClose={vi.fn()}
          title="Approval Required"
          description="Review exact proposals before file export."
        >
          <div>
            <p>Target: ./reports/brief.md</p>
            <Button variant="primary">Confirm Export</Button>
          </div>
        </ModalDialog>,
      );
      const results = await axe(container, axeComponentOptions);
      expect(results).toHaveNoViolations();
    });
  });

  // =========================================================================
  // 6. Drawer Primitive
  // =========================================================================
  describe('Drawer', () => {
    it('renders slide-over dialog with accessible title, subtitle, and body', () => {
      render(
        <Drawer
          isOpen={true}
          onClose={vi.fn()}
          title="Run Detail #402"
          subtitle="Research brief execution trace"
          badge={<StatusBadge state="running" />}
        >
          <div>Drawer body content with step cards.</div>
        </Drawer>,
      );

      const drawer = screen.getByRole('dialog', { name: 'Run Detail #402' });
      expect(drawer).toBeInTheDocument();
      expect(drawer).toHaveAttribute('aria-modal', 'true');
      expect(screen.getByText('Research brief execution trace')).toBeInTheDocument();
      expect(screen.getByText('Drawer body content with step cards.')).toBeInTheDocument();
    });

    it('calls onClose when close button is clicked', async () => {
      const user = userEvent.setup();
      const handleClose = vi.fn();

      render(
        <Drawer isOpen={true} onClose={handleClose} title="Run Inspection">
          <p>Inspection details.</p>
        </Drawer>,
      );

      const closeButton = screen.getByRole('button', { name: 'Close drawer' });
      await user.click(closeButton);
      expect(handleClose).toHaveBeenCalledTimes(1);
    });

    it('has zero accessibility violations when open (axe)', async () => {
      const { container } = render(
        <Drawer
          isOpen={true}
          onClose={vi.fn()}
          title="Run Detail #101"
          subtitle="Task failed with provider timeout"
          footer={<Button variant="primary">Retry Task</Button>}
        >
          <Card>
            <CardTitle>Root Cause: Provider Timeout</CardTitle>
            <CardBody>The model provider did not respond within 30 seconds.</CardBody>
          </Card>
        </Drawer>,
      );
      const results = await axe(container, axeComponentOptions);
      expect(results).toHaveNoViolations();
    });
  });

  // =========================================================================
  // 7. Design Token Contrast Verification (WCAG 1.4.11 Non-text Contrast)
  // =========================================================================
  describe('Boundary Token Contrast Verification', () => {
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

    it('verifies --border-queued meets non-text contrast (>= 3.0:1) over --panel-inset', () => {
      // --border-queued: rgba(69, 198, 242, 0.50) over --panel-inset: #080d16
      const ratio = contrastRatioRgbaOverBg([69, 198, 242, 0.50], '#080d16');
      expect(ratio).toBeGreaterThanOrEqual(3.0);
    });
  });
});
