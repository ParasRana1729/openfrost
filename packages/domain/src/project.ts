import { z } from 'zod';

/**
 * A project organizes one assistant's context (spec §4): instructions and
 * explicitly granted source folder roots. Projects scope tasks and
 * conversations; they are not separate assistant personalities.
 */
export const projectSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  /** Owner-authored standing instructions injected into project-scoped tasks. */
  instructions: z.string().max(5000).nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type Project = z.infer<typeof projectSchema>;

/**
 * One explicitly granted folder root. The stored path is the canonicalized
 * absolute path recorded at grant time; every execution re-canonicalizes and
 * re-checks it, so a moved or junction-swapped folder stops granting access.
 */
export const projectFolderGrantSchema = z.strictObject({
  id: z.string().min(1),
  projectId: z.string().min(1),
  path: z.string().min(1).max(1000),
  createdAt: z.string().min(1),
});
export type ProjectFolderGrant = z.infer<typeof projectFolderGrantSchema>;

/** A project together with its current grants (API response shape). */
export const projectWithGrantsSchema = z.strictObject({
  ...projectSchema.shape,
  grants: z.array(projectFolderGrantSchema),
});
export type ProjectWithGrants = z.infer<typeof projectWithGrantsSchema>;

export const createProjectRequestSchema = z.strictObject({
  name: z.string().min(1).max(200),
  instructions: z.string().max(5000).optional(),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const updateProjectRequestSchema = z.strictObject({
  name: z.string().min(1).max(200).optional(),
  instructions: z.string().max(5000).optional(),
});
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

export const grantFolderRequestSchema = z.strictObject({
  /** Absolute path of the folder root the owner is granting. */
  path: z.string().min(1).max(1000),
});
export type GrantFolderRequest = z.infer<typeof grantFolderRequestSchema>;
