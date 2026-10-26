'use client';

import React, { useRef } from 'react';
import type { Task } from '@openfrost/domain';
import { ModalDialog } from './ui/ModalDialog';
import { TaskComposer, type ProjectSummary, type TaskComposerProps } from './TaskComposer';

export interface NewTaskDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projects: ProjectSummary[];
  activeProjectId?: string | null;
  initialValues?: TaskComposerProps['initialValues'];
  onSuccess?: (task: Task) => void;
}

export function NewTaskDialog({
  isOpen,
  onClose,
  projects,
  activeProjectId,
  initialValues,
  onSuccess,
}: NewTaskDialogProps) {
  // Focus ref wired directly to the composer's primary request textarea
  const initialFocusRef = useRef<HTMLTextAreaElement | null>(null);

  const handleSuccess = (task: Task) => {
    onSuccess?.(task);
    onClose();
  };

  return (
    <ModalDialog
      isOpen={isOpen}
      onClose={onClose}
      title="New task"
      description="Queue a research brief or project update for the assistant."
      maxWidth="lg"
      initialFocusRef={initialFocusRef}
    >
      <TaskComposer
        projects={projects}
        activeProjectId={activeProjectId}
        initialValues={initialValues}
        onSuccess={handleSuccess}
        onCancel={onClose}
        inline={false}
        initialFocusRef={initialFocusRef}
      />
    </ModalDialog>
  );
}
