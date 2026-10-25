import { describe, expect, it } from 'vitest';
import {
  createProjectRequestSchema,
  grantFolderRequestSchema,
  projectFolderGrantSchema,
  projectSchema,
  projectWithGrantsSchema,
  updateProjectRequestSchema,
} from '../src/index.js';

const NOW = '2026-10-25T12:00:00.000Z';

function sampleProject(overrides: Record<string, unknown> = {}) {
  return projectSchema.parse({
    id: 'project-1',
    name: 'Thesis',
    instructions: 'Cite chapter files by absolute path.',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
}

describe('project schema', () => {
  it('accepts a valid project with null instructions', () => {
    const project = sampleProject({ instructions: null });
    expect(project.name).toBe('Thesis');
    expect(project.instructions).toBeNull();
  });

  it('rejects unknown fields, empty names, and overlong text', () => {
    expect(() => sampleProject({ surprise: true })).toThrowError();
    expect(() => sampleProject({ name: '' })).toThrowError();
    expect(() => sampleProject({ name: 'x'.repeat(201) })).toThrowError();
    expect(() => sampleProject({ instructions: 'x'.repeat(5001) })).toThrowError();
  });
});

describe('project folder grant schema', () => {
  it('accepts a canonical absolute path', () => {
    const grant = projectFolderGrantSchema.parse({
      id: 'grant-1',
      projectId: 'project-1',
      path: 'C:\\Users\\owner\\notes',
      createdAt: NOW,
    });
    expect(grant.projectId).toBe('project-1');
  });

  it('rejects empty paths and unknown fields', () => {
    expect(() =>
      projectFolderGrantSchema.parse({
        id: 'grant-1',
        projectId: 'project-1',
        path: '',
        createdAt: NOW,
      }),
    ).toThrowError();
    expect(() =>
      projectFolderGrantSchema.parse({
        id: 'grant-1',
        projectId: 'project-1',
        path: 'C:\\notes',
        createdAt: NOW,
        extra: 1,
      }),
    ).toThrowError();
  });
});

describe('project with grants (API response shape)', () => {
  it('embeds the grant list', () => {
    const parsed = projectWithGrantsSchema.parse({
      ...sampleProject(),
      grants: [
        {
          id: 'grant-1',
          projectId: 'project-1',
          path: 'C:\\Users\\owner\\notes',
          createdAt: NOW,
        },
      ],
    });
    expect(parsed.grants).toHaveLength(1);
  });
});

describe('project request schemas', () => {
  it('create accepts a name and optional instructions', () => {
    expect(createProjectRequestSchema.parse({ name: 'Thesis' }).instructions).toBeUndefined();
    expect(
      createProjectRequestSchema.parse({ name: 'Thesis', instructions: 'Be concise.' })
        .instructions,
    ).toBe('Be concise.');
    expect(() => createProjectRequestSchema.parse({})).toThrowError();
    expect(() => createProjectRequestSchema.parse({ name: 'x'.repeat(201) })).toThrowError();
  });

  it('update rejects empty objects implicitly and validates bounds', () => {
    expect(updateProjectRequestSchema.parse({ name: 'Renamed' }).name).toBe('Renamed');
    expect(() => updateProjectRequestSchema.parse({ name: '' })).toThrowError();
    expect(() => updateProjectRequestSchema.parse({ instructions: 'x'.repeat(5001) }))
      .toThrowError();
  });

  it('grant requires a non-empty path string', () => {
    expect(grantFolderRequestSchema.parse({ path: 'D:\\project notes' }).path).toBe(
      'D:\\project notes',
    );
    expect(() => grantFolderRequestSchema.parse({ path: '' })).toThrowError();
    expect(() => grantFolderRequestSchema.parse({})).toThrowError();
  });
});
