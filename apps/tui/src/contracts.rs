//! Serde types mirroring `packages/domain` Zod contracts (the source of
//! truth). Request bodies serialize only declared fields because the API
//! validates with `z.strictObject`. Fixtures in this file's tests are kept in
//! sync with the Zod schemas; the API remains the enforcement point.

// The structs mirror the full API payloads even where the TUI does not yet
// render every field; the serde derives consume them regardless.
// Field names intentionally match the JSON contract (camelCase) so no
// rename mapping can drift from packages/domain.
#![allow(dead_code, non_snake_case)]

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskState {
    Queued,
    Running,
    AwaitingApproval,
    Completed,
    Failed,
    Canceled,
    Interrupted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskKind {
    ResearchBrief,
    ProjectUpdate,
    ExportReport,
    WeeklyPlan,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    Running,
    Completed,
    Failed,
    Canceled,
    Interrupted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunLimitKind {
    MaxSteps,
    WallClock,
    MaxInput,
    MaxOutput,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalState {
    Pending,
    Granted,
    Rejected,
    Canceled,
    Expired,
    Executed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskTier {
    Auto,
    Telegram,
    Local,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryScope {
    Global,
    Project,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryProposalState {
    Pending,
    Approved,
    Rejected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoutineState {
    Active,
    Paused,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoutineOccurrenceState {
    Scheduled,
    Missed,
    Skipped,
}

// ---------------------------------------------------------------------------
// Events (SSE payloads and the recent-activity feed)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct Event {
    pub id: i64,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub taskId: Option<String>,
    #[serde(default)]
    pub runId: Option<String>,
    #[serde(default)]
    pub payload: serde_json::Map<String, Value>,
    pub createdAt: String,
}

// ---------------------------------------------------------------------------
// Tasks and runs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct ExportArgs {
    pub artifactId: String,
    pub destinationId: String,
    pub filename: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub request: String,
    pub constraints: Option<String>,
    pub startingUrls: Option<Vec<String>>,
    pub projectId: Option<String>,
    pub kind: TaskKind,
    pub exportArgs: Option<ExportArgs>,
    pub routineId: Option<String>,
    pub state: TaskState,
    pub attemptCount: i64,
    pub lastRunId: Option<String>,
    pub resultArtifactId: Option<String>,
    pub error: Option<String>,
    pub createdAt: String,
    pub updatedAt: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RunUsage {
    pub steps: i64,
    pub inputChars: i64,
    pub outputChars: i64,
    pub inputTokens: Option<i64>,
    pub outputTokens: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RunFailure {
    pub code: String,
    pub message: String,
    pub limitHit: Option<RunLimitKind>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgentRun {
    pub id: String,
    pub taskId: String,
    pub attempt: i64,
    pub state: RunState,
    pub startedAt: String,
    pub endedAt: Option<String>,
    pub usage: Option<RunUsage>,
    pub failure: Option<RunFailure>,
}

/// `GET /api/tasks` response: every task plus the global executor status.
#[derive(Debug, Clone, Deserialize)]
pub struct TasksResponse {
    pub tasks: Vec<Task>,
    pub executor: ExecutorStatus,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ExecutorStatus {
    pub busy: bool,
    pub activeTaskId: Option<String>,
    pub dispatchPaused: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TaskDetail {
    pub task: Task,
    pub runs: Vec<AgentRun>,
    pub events: Vec<Event>,
    pub artifact: Option<TaskDetailArtifact>,
    pub approval: Option<Approval>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TaskDetailArtifact {
    pub id: String,
    pub markdown: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct CreateTaskRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub request: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub constraints: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub startingUrls: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub projectId: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<TaskKind>,
}

// ---------------------------------------------------------------------------
// Approvals and exports
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct ApprovalOutcome {
    pub file: String,
    pub bytes: i64,
    pub ms: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Approval {
    pub id: String,
    pub taskId: String,
    pub runId: String,
    pub action: String,
    pub artifactId: String,
    pub destinationId: String,
    pub destinationPath: String,
    pub filename: String,
    pub contentSha256: String,
    pub riskTier: RiskTier,
    pub state: ApprovalState,
    pub requestedAt: String,
    pub expiresAt: String,
    pub decidedAt: Option<String>,
    pub executedAt: Option<String>,
    pub outcome: Option<ApprovalOutcome>,
    pub refusalReason: Option<String>,
}

/// The review view from `GET /api/approvals` carries the exact proposed
/// content alongside the approval record (spec §6).
#[derive(Debug, Clone, Deserialize)]
pub struct ApprovalView {
    #[serde(flatten)]
    pub approval: Approval,
    pub artifactChars: Option<i64>,
    pub artifactMarkdown: Option<String>,
    pub taskTitle: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ApprovalsResponse {
    pub approvals: Vec<ApprovalView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GrantDecision {
    pub decision: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CreateExportRequest {
    pub artifactId: String,
    pub destinationId: String,
    pub filename: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ExportDestination {
    pub id: String,
    pub path: String,
    pub createdAt: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DestinationsResponse {
    pub destinations: Vec<ExportDestination>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExportDestinationRequest {
    pub path: String,
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct ProjectFolderGrant {
    pub id: String,
    pub projectId: String,
    pub path: String,
    pub createdAt: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub instructions: Option<String>,
    pub createdAt: String,
    pub updatedAt: String,
    pub grants: Vec<ProjectFolderGrant>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProjectsResponse {
    pub projects: Vec<Project>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct CreateProjectRequest {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct UpdateProjectRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GrantFolderRequest {
    pub path: String,
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct MemorySource {
    pub kind: String,
    pub taskId: Option<String>,
    pub artifactId: Option<String>,
    pub label: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MemoryEntry {
    pub id: String,
    pub scope: MemoryScope,
    pub projectId: Option<String>,
    pub content: String,
    pub source: MemorySource,
    pub createdAt: String,
    pub updatedAt: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MemoryProposal {
    pub id: String,
    pub scope: MemoryScope,
    pub projectId: Option<String>,
    pub content: Option<String>,
    pub source: MemorySource,
    pub sourceRunId: Option<String>,
    pub state: MemoryProposalState,
    pub proposedAt: String,
    pub decidedAt: Option<String>,
    pub memoryEntryId: Option<String>,
    pub proposedContentSha256: String,
    pub decidedContentSha256: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MemoryFileView {
    pub scope: MemoryScope,
    #[serde(default)]
    pub projectId: Option<String>,
    pub path: String,
    pub exists: bool,
    pub sha256: Option<String>,
    pub entries: Vec<MemoryEntry>,
    pub problems: Vec<String>,
    pub externalChange: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProjectMemoryView {
    pub scope: MemoryScope,
    pub projectId: String,
    pub projectName: String,
    pub path: String,
    pub exists: bool,
    pub sha256: Option<String>,
    pub entries: Vec<MemoryEntry>,
    pub problems: Vec<String>,
    pub externalChange: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MemorySnapshot {
    pub global: MemoryFileView,
    pub projects: Vec<ProjectMemoryView>,
    pub proposals: Vec<MemoryProposal>,
    pub limits: MemoryLimits,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MemoryLimits {
    pub contentMaxChars: i64,
    pub entriesPerFile: i64,
    pub contextMaxChars: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApproveMemoryProposalRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    pub fileSha256: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UpdateMemoryEntryRequest {
    pub content: String,
    pub fileSha256: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeleteMemoryEntryRequest {
    pub fileSha256: String,
}

// ---------------------------------------------------------------------------
// Routines
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RoutineSchedule {
    Weekly { weekday: i64, time: String },
    Daily { time: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutineTemplate {
    pub title: String,
    pub request: String,
    pub constraints: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Routine {
    pub id: String,
    pub name: String,
    pub projectId: String,
    pub timezone: String,
    pub schedule: RoutineSchedule,
    pub template: RoutineTemplate,
    pub state: RoutineState,
    pub windowStartAt: String,
    pub lastOccurrenceKey: Option<String>,
    pub lastOccurrenceAt: Option<String>,
    pub createdAt: String,
    pub updatedAt: String,
}

/// `GET /api/routines` item: the routine plus computed scheduling views.
#[derive(Debug, Clone, Deserialize)]
pub struct RoutineView {
    #[serde(flatten)]
    pub routine: Routine,
    pub nextOccurrenceAt: Option<String>,
    pub nextOccurrenceKey: Option<String>,
    pub missedCount: i64,
    pub projectName: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RoutinesResponse {
    pub routines: Vec<RoutineView>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RoutineOccurrence {
    pub id: String,
    pub routineId: String,
    pub occurrenceKey: String,
    pub scheduledFor: String,
    pub state: RoutineOccurrenceState,
    pub taskId: Option<String>,
    pub reason: Option<String>,
    pub createdAt: String,
    pub updatedAt: String,
    pub decidedAt: Option<String>,
    /// Present on the detail endpoint when the occurrence has a task.
    #[serde(default)]
    pub task: Option<Task>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CreateRoutineRequest {
    pub name: String,
    pub projectId: String,
    pub timezone: String,
    pub schedule: RoutineSchedule,
    pub template: RoutineTemplate,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct UpdateRoutineRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub projectId: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timezone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule: Option<RoutineSchedule>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template: Option<RoutineTemplate>,
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct ExecutionLimits {
    pub maxSteps: i64,
    pub maxWallClockMs: i64,
    pub maxInputChars: i64,
    pub maxOutputChars: i64,
}

/// Owner-facing settings; never carries a raw provider key.
#[derive(Debug, Clone, Deserialize)]
pub struct AssistantSettings {
    pub provider: String,
    pub model: Option<String>,
    pub models: ProviderModels,
    pub hasProviderKey: bool,
    pub hasOpenAIKey: bool,
    pub hasGeminiKey: bool,
    pub hasOpenRouterKey: bool,
    pub executionLimits: ExecutionLimits,
    pub onboardingCompletedAt: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProviderModels {
    pub openai: String,
    pub gemini: String,
    pub openrouter: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SetProviderKeyRequest {
    pub provider: String,
    pub key: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SetProviderConfigRequest {
    pub provider: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct SessionResponse {
    pub authenticated: bool,
    pub ownerCreated: bool,
    pub onboardingCompletedAt: Option<String>,
    pub csrfToken: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CredentialsRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    pub password: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AuthSuccess {
    pub authenticated: bool,
    pub csrfToken: String,
}

// ---------------------------------------------------------------------------
// Tests: fixtures mirroring the Zod schemas
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_task_fixture() {
        let raw = r#"{
            "id": "t1",
            "title": "Compare options",
            "request": "Compare A and B",
            "constraints": null,
            "startingUrls": ["https://example.com"],
            "projectId": null,
            "kind": "research_brief",
            "exportArgs": null,
            "routineId": null,
            "state": "queued",
            "attemptCount": 0,
            "lastRunId": null,
            "resultArtifactId": null,
            "error": null,
            "createdAt": "2026-10-26T00:00:00.000Z",
            "updatedAt": "2026-10-26T00:00:00.000Z"
        }"#;
        let task: Task = serde_json::from_str(raw).unwrap();
        assert_eq!(task.title, "Compare options");
        assert_eq!(task.kind, TaskKind::ResearchBrief);
        assert_eq!(task.state, TaskState::Queued);
        assert_eq!(
            task.startingUrls.as_deref(),
            Some(&["https://example.com".to_string()][..])
        );
    }

    #[test]
    fn parses_tasks_response_with_executor() {
        let raw = r#"{
            "tasks": [],
            "executor": { "busy": true, "activeTaskId": "t1", "dispatchPaused": false }
        }"#;
        let response: TasksResponse = serde_json::from_str(raw).unwrap();
        assert!(response.executor.busy);
        assert_eq!(response.executor.activeTaskId.as_deref(), Some("t1"));
    }

    #[test]
    fn parses_task_detail_fixture() {
        let raw = r##"{
            "task": {
                "id": "t1", "title": "T", "request": "R", "constraints": null,
                "startingUrls": null, "projectId": null, "kind": "research_brief",
                "exportArgs": null, "routineId": null, "state": "completed",
                "attemptCount": 1, "lastRunId": "r1", "resultArtifactId": "a1",
                "error": null, "createdAt": "2026-10-26T00:00:00.000Z",
                "updatedAt": "2026-10-26T00:01:00.000Z"
            },
            "runs": [{
                "id": "r1", "taskId": "t1", "attempt": 1, "state": "completed",
                "startedAt": "2026-10-26T00:00:00.000Z", "endedAt": "2026-10-26T00:01:00.000Z",
                "usage": { "steps": 3, "inputChars": 100, "outputChars": 200,
                           "inputTokens": null, "outputTokens": null },
                "failure": null
            }],
            "events": [{
                "id": 1, "type": "run.started", "taskId": "t1", "runId": "r1",
                "payload": {}, "createdAt": "2026-10-26T00:00:00.000Z"
            }],
            "artifact": { "id": "a1", "markdown": "# Report" },
            "approval": null
        }"##;
        let detail: TaskDetail = serde_json::from_str(raw).unwrap();
        assert_eq!(detail.runs.len(), 1);
        assert_eq!(detail.runs[0].usage.as_ref().unwrap().steps, 3);
        assert_eq!(detail.artifact.as_ref().unwrap().markdown, "# Report");
        assert_eq!(detail.events[0].kind, "run.started");
    }

    #[test]
    fn parses_approval_view_fixture() {
        let raw = r##"{
            "id": "ap1", "taskId": "t1", "runId": "r1", "action": "export_file",
            "artifactId": "a1", "destinationId": "d1",
            "destinationPath": "C:\\exports", "filename": "report-1.md",
            "contentSha256": "0000000000000000000000000000000000000000000000000000000000000000",
            "riskTier": "telegram",
            "state": "pending", "requestedAt": "2026-10-26T00:00:00.000Z",
            "expiresAt": "2026-10-27T00:00:00.000Z", "decidedAt": null,
            "executedAt": null, "outcome": null, "refusalReason": null,
            "artifactChars": 12, "artifactMarkdown": "# Report\n\nBody",
            "taskTitle": "Export brief"
        }"##;
        let view: ApprovalView = serde_json::from_str(raw).unwrap();
        assert_eq!(view.approval.state, ApprovalState::Pending);
        assert_eq!(view.approval.riskTier, RiskTier::Telegram);
        assert_eq!(view.taskTitle.as_deref(), Some("Export brief"));
        assert_eq!(view.artifactMarkdown.as_deref(), Some("# Report\n\nBody"));
    }

    #[test]
    fn parses_memory_snapshot_fixture() {
        let raw = r#"{
            "global": {
                "scope": "global", "projectId": null, "path": "C:\\mem\\owner.md",
                "exists": true, "sha256": null, "entries": [{
                    "id": "m1", "scope": "global", "projectId": null,
                    "content": "Prefer concise answers.",
                    "source": { "kind": "owner", "taskId": null, "artifactId": null,
                                "label": "owner" },
                    "createdAt": "2026-10-26T00:00:00.000Z",
                    "updatedAt": "2026-10-26T00:00:00.000Z"
                }],
                "problems": [], "externalChange": false
            },
            "projects": [{
                "scope": "project", "projectId": "p1", "projectName": "Demo",
                "path": "C:\\mem\\p1.md", "exists": false, "sha256": null,
                "entries": [], "problems": [], "externalChange": false
            }],
            "proposals": [],
            "limits": { "contentMaxChars": 4000, "entriesPerFile": 50,
                        "contextMaxChars": 6000 }
        }"#;
        let snapshot: MemorySnapshot = serde_json::from_str(raw).unwrap();
        assert_eq!(snapshot.global.entries.len(), 1);
        assert_eq!(snapshot.projects[0].projectName, "Demo");
    }

    #[test]
    fn parses_routine_view_fixture() {
        let raw = r#"{
            "id": "rt1", "name": "Friday planning", "projectId": "p1",
            "timezone": "Asia/Kolkata",
            "schedule": { "kind": "weekly", "weekday": 5, "time": "09:00" },
            "template": { "title": "Weekly plan", "request": "Draft priorities",
                          "constraints": null },
            "state": "active", "windowStartAt": "2026-10-01T00:00:00.000Z",
            "lastOccurrenceKey": null, "lastOccurrenceAt": null,
            "createdAt": "2026-10-01T00:00:00.000Z",
            "updatedAt": "2026-10-01T00:00:00.000Z",
            "nextOccurrenceAt": "2026-10-30T03:30:00.000Z",
            "nextOccurrenceKey": "2026-10-30",
            "missedCount": 1, "projectName": "Demo"
        }"#;
        let view: RoutineView = serde_json::from_str(raw).unwrap();
        assert_eq!(view.routine.state, RoutineState::Active);
        assert_eq!(
            view.routine.schedule,
            RoutineSchedule::Weekly {
                weekday: 5,
                time: "09:00".into()
            }
        );
        assert_eq!(view.missedCount, 1);
    }

    #[test]
    fn parses_settings_fixture() {
        let raw = r#"{
            "provider": "openrouter", "model": "free/model", 
            "models": { "openai": "gpt-4o-mini", "gemini": "gemini-2.0-flash",
                        "openrouter": "free/model" },
            "hasProviderKey": true, "hasOpenAIKey": false,
            "hasGeminiKey": false, "hasOpenRouterKey": true,
            "executionLimits": { "maxSteps": 12, "maxWallClockMs": 600000,
                                 "maxInputChars": 20000, "maxOutputChars": 100000 },
            "onboardingCompletedAt": null
        }"#;
        let settings: AssistantSettings = serde_json::from_str(raw).unwrap();
        assert_eq!(settings.provider, "openrouter");
        assert!(settings.hasProviderKey);
    }

    #[test]
    fn create_task_request_omits_unset_fields() {
        let request = CreateTaskRequest {
            title: None,
            request: "Do the thing".into(),
            constraints: None,
            startingUrls: None,
            projectId: None,
            kind: Some(TaskKind::ResearchBrief),
        };
        let json = serde_json::to_value(&request).unwrap();
        let obj = json.as_object().unwrap();
        // strictObject on the API rejects unknown keys; unset optionals must be absent.
        assert!(!obj.contains_key("title"));
        assert!(!obj.contains_key("constraints"));
        assert!(!obj.contains_key("projectId"));
        assert_eq!(obj["request"], "Do the thing");
        assert_eq!(obj["kind"], "research_brief");
    }

    #[test]
    fn parses_session_fixture() {
        let raw = r#"{ "authenticated": true, "ownerCreated": true,
                       "onboardingCompletedAt": "2026-10-26T00:00:00.000Z",
                       "csrfToken": "tok" }"#;
        let session: SessionResponse = serde_json::from_str(raw).unwrap();
        assert!(session.authenticated);
        assert_eq!(session.csrfToken.as_deref(), Some("tok"));
    }
}
