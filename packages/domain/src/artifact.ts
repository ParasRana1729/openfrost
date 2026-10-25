import { z } from 'zod';

/** `report` is a research brief; `project_update` is an evidence-backed
 * update produced from a project's granted files. */
export const artifactKindSchema = z.enum(['report', 'project_update']);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

export const artifactSchema = z.strictObject({
  id: z.string().min(1),
  taskId: z.string().min(1).nullable(),
  kind: artifactKindSchema,
  markdown: z.string().min(1),
  createdAt: z.string().min(1),
});
export type Artifact = z.infer<typeof artifactSchema>;
