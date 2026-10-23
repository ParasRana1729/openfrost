import { z } from 'zod';

export const artifactKindSchema = z.enum(['report']);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

export const artifactSchema = z.strictObject({
  id: z.string().min(1),
  taskId: z.string().min(1).nullable(),
  kind: artifactKindSchema,
  markdown: z.string().min(1),
  createdAt: z.string().min(1),
});
export type Artifact = z.infer<typeof artifactSchema>;
