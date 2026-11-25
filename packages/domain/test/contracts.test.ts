import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as domain from '../src/index.js';

const fixtureDir = new URL('./fixtures/contracts/', import.meta.url);
const casesSchema = z.array(z.strictObject({
  name: z.string().min(1),
  value: z.record(z.string(), z.unknown()),
})).min(1);
function fixtures(name: string) {
  const input: unknown = JSON.parse(readFileSync(new URL(`${name}.json`, fixtureDir), 'utf8'));
  return casesSchema.parse(input);
}
const responses = {
  Task: domain.taskSchema,
  TasksResponse: domain.tasksResponseSchema,
  TaskDetail: domain.taskDetailSchema,
  Approval: domain.approvalSchema,
  ApprovalsResponse: domain.approvalsResponseSchema,
  Project: domain.projectSchema,
  ProjectWithGrants: domain.projectWithGrantsSchema,
  ProjectsResponse: domain.projectsResponseSchema,
  MemorySnapshot: domain.memorySnapshotSchema,
  Routine: domain.routineSchema,
  RoutineView: domain.routineViewSchema,
  RoutinesResponse: domain.routinesResponseSchema,
  RoutineOccurrence: domain.routineOccurrenceViewSchema,
  RoutineDetail: domain.routineDetailSchema,
  AssistantSettings: domain.assistantSettingsSchema,
  DestinationsResponse: domain.destinationsResponseSchema,
  Event: domain.eventSchema,
};
const requests = {
  CreateTaskRequest: domain.createTaskRequestSchema,
  CreateProjectRequest: domain.createProjectRequestSchema,
  UpdateProjectRequest: domain.updateProjectRequestSchema,
  GrantFolderRequest: domain.grantFolderRequestSchema,
  CreateExportRequest: domain.createExportRequestSchema,
  ExportDestinationRequest: domain.exportDestinationRequestSchema,
  GrantDecision: domain.grantDecisionSchema,
  CreateRoutineRequest: domain.createRoutineRequestSchema,
  UpdateRoutineRequest: domain.updateRoutineRequestSchema,
  SetProviderConfigRequest: domain.setProviderConfigRequestSchema,
  SetProviderKeyRequest: domain.setProviderKeyRequestSchema,
  ApproveMemoryProposalRequest: domain.approveMemoryProposalRequestSchema,
  UpdateMemoryEntryRequest: domain.updateMemoryEntryRequestSchema,
  DeleteMemoryEntryRequest: domain.deleteMemoryEntryRequestSchema,
};
const enums = {
  TaskState: domain.taskStateSchema,
  TaskKind: domain.taskKindSchema,
  RunState: domain.runStateSchema,
  RunLimitKind: domain.runLimitKindSchema,
  ApprovalState: domain.approvalStateSchema,
  RiskTier: domain.riskTierSchema,
  MemoryScope: domain.memoryScopeSchema,
  ProviderId: domain.providerIdSchema,
  RoutineState: domain.routineStateSchema,
  RoutineOccurrenceState: domain.routineOccurrenceStateSchema,
  MemoryProposalState: domain.memoryProposalStateSchema,
};

describe('shared Rust / Zod contract fixtures', () => {
  it('registers every checked-in JSON file (no silently untested fixtures)', () => {
    expect(readdirSync(fileURLToPath(fixtureDir)).filter((f) => f.endsWith('.json')).sort())
      .toEqual([...Object.keys(responses), ...Object.keys(requests), 'enums'].map((n) => `${n}.json`).sort());
  });
  for (const [name, schema] of Object.entries({ ...responses, ...requests })) {
    describe(name, () => {
      for (const fixture of fixtures(name)) {
        it(fixture.name, () => {
          expect(schema.safeParse(fixture.value).success).toBe(true);
        });
      }
    });
  }
  for (const [name, schema] of Object.entries(requests)) {
    it(`${name} rejects undeclared fields, not just invalid values`, () => {
      for (const fixture of fixtures(name)) {
        expect(schema.safeParse({ ...fixture.value, unexpected: true }).success).toBe(false);
      }
    });
  }
  const enumInput: unknown = JSON.parse(readFileSync(new URL('enums.json', fixtureDir), 'utf8'));
  const enumFixtures = z.record(z.string(), z.array(z.string()).min(1)).parse(enumInput);
  it('registers every enum fixture', () => {
    expect(Object.keys(enumFixtures).sort()).toEqual(Object.keys(enums).sort());
  });
  for (const [name, schema] of Object.entries(enums)) {
    it(`${name} includes exactly every Zod enum variant`, () => {
      expect(enumFixtures[name]).toEqual(schema.options);
      expect(schema.safeParse('unknown_variant').success).toBe(false);
    });
  }
  it('covers every event type in real event payloads', () => {
    expect(fixtures('Event').map((f) => f.value.type)).toEqual(domain.eventTypeSchema.options);
  });
  const optionalFields: ReadonlyArray<[keyof typeof requests, readonly string[]]> = [
    ['CreateTaskRequest', ['constraints', 'startingUrls', 'projectId', 'kind']],
    ['CreateProjectRequest', ['instructions']],
    ['UpdateProjectRequest', ['name', 'instructions']],
    ['UpdateRoutineRequest', ['name', 'projectId', 'timezone', 'schedule', 'template']],
    ['SetProviderConfigRequest', ['model']],
    ['ApproveMemoryProposalRequest', ['content']],
  ];
  for (const [name, fields] of optionalFields) {
    for (const field of fields) {
      it(`${name}.${field}: optional does not imply nullable`, () => {
        const input = { ...fixtures(name)[0]?.value, [field]: null };
        expect(requests[name].safeParse(input).success)
          .toBe(name === 'SetProviderConfigRequest' && field === 'model');
      });
    }
  }
  it('distinguishes required, optional, and nullable request fields', () => {
    expect(domain.createTaskRequestSchema.safeParse({ request: 'Missing title' }).success).toBe(false);
    expect(domain.createTaskRequestSchema.safeParse({ title: 'T', request: 'R', constraints: null }).success).toBe(false);
    expect(domain.approveMemoryProposalRequestSchema.safeParse({}).success).toBe(false);
    expect(domain.setProviderConfigRequestSchema.safeParse({ provider: 'openai', model: null }).success).toBe(true);
    expect(domain.setProviderConfigRequestSchema.safeParse({ provider: 'openrouter', model: '' }).success).toBe(true);
    expect(domain.setProviderConfigRequestSchema.safeParse({ provider: 'openrouter', model: '   ' }).success).toBe(true);
  });
});
