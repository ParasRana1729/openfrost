//! Serde types mirroring `packages/domain` Zod contracts (the source of
//! truth). Request bodies serialize only declared fields because the API
//! validates with `z.strictObject`. Shared JSON fixtures are validated by both Rust and
//! the real Zod schemas; the API remains the enforcement point.

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderId {
    Openai,
    Gemini,
    Openrouter,
}

// ---------------------------------------------------------------------------
// Events (SSE payloads and the recent-activity feed)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportArgs {
    pub artifactId: String,
    pub destinationId: String,
    pub filename: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunUsage {
    pub steps: i64,
    pub inputChars: i64,
    pub outputChars: i64,
    pub inputTokens: Option<i64>,
    pub outputTokens: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunFailure {
    pub code: String,
    pub message: String,
    pub limitHit: Option<RunLimitKind>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TasksResponse {
    pub tasks: Vec<Task>,
    pub executor: ExecutorStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutorStatus {
    pub busy: bool,
    pub activeTaskId: Option<String>,
    pub dispatchPaused: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskDetail {
    pub task: Task,
    pub runs: Vec<AgentRun>,
    pub events: Vec<Event>,
    pub artifact: Option<TaskDetailArtifact>,
    pub approval: Option<Approval>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskDetailArtifact {
    pub id: String,
    pub markdown: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct CreateTaskRequest {
    #[serde(serialize_with = "serialize_required_title")]
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

fn serialize_required_title<S: serde::Serializer>(
    title: &Option<String>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    title
        .as_ref()
        .ok_or_else(|| serde::ser::Error::custom("task title is required"))?
        .serialize(serializer)
}

// ---------------------------------------------------------------------------
// Approvals and exports
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalOutcome {
    pub file: String,
    pub bytes: i64,
    pub ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalView {
    #[serde(flatten)]
    pub approval: Approval,
    pub artifactChars: Option<i64>,
    pub artifactMarkdown: Option<String>,
    pub taskTitle: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportDestination {
    pub id: String,
    pub path: String,
    pub createdAt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectFolderGrant {
    pub id: String,
    pub projectId: String,
    pub path: String,
    pub createdAt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub instructions: Option<String>,
    pub createdAt: String,
    pub updatedAt: String,
    // PUT /projects/:id returns the base entity without grants.
    #[serde(default)]
    pub grants: Vec<ProjectFolderGrant>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemorySource {
    pub kind: String,
    pub taskId: Option<String>,
    pub artifactId: Option<String>,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEntry {
    pub id: String,
    pub scope: MemoryScope,
    pub projectId: Option<String>,
    pub content: String,
    pub source: MemorySource,
    pub createdAt: String,
    pub updatedAt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemorySnapshot {
    pub global: MemoryFileView,
    pub projects: Vec<ProjectMemoryView>,
    pub proposals: Vec<MemoryProposal>,
    pub limits: MemoryLimits,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutineView {
    pub routine: Routine,
    pub nextOccurrenceAt: Option<String>,
    pub nextOccurrenceKey: Option<String>,
    pub missedCount: i64,
    pub projectName: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutinesResponse {
    pub routines: Vec<RoutineView>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionLimits {
    pub maxSteps: i64,
    pub maxWallClockMs: i64,
    pub maxInputChars: i64,
    pub maxOutputChars: i64,
}

/// Owner-facing settings; never carries a raw provider key.
#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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
// `Some(None)` represents an explicit model reset; the default String keeps
// existing callers' None = omitted (preserve the configured model) behavior.
pub struct SetProviderConfigRequest<Model = String> {
    pub provider: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<Model>,
}

// ---------------------------------------------------------------------------
// Tests: canonical JSON is shared with packages/domain/test/contracts.test.ts.
// Requests are constructed as actual Rust structs, never deserialized from
// their expected JSON: renames, extra fields and null/omission drift must fail.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde::de::DeserializeOwned;
    use std::path::PathBuf;

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Fixture {
        name: String,
        value: Value,
    }

    fn fixture_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/domain/test/fixtures/contracts")
    }

    fn fixtures(name: &str) -> Vec<Fixture> {
        let path = fixture_dir().join(format!("{name}.json"));
        let raw =
            std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        let cases: Vec<Fixture> = serde_json::from_str(&raw).unwrap();
        assert!(!cases.is_empty(), "{name}: empty fixture suite");
        cases
    }

    // Serde intentionally tolerates future response fields, but fixtures must
    // not silently lose known fields through a rename, omission or flatten.
    fn assert_fields_preserved(actual: &Value, expected: &Value) {
        match expected {
            Value::Object(fields) => {
                for (key, expected) in fields {
                    let actual = actual
                        .get(key)
                        .unwrap_or_else(|| panic!("lost response field: {key}"));
                    assert_fields_preserved(actual, expected);
                }
            }
            Value::Array(values) => {
                let actual = actual.as_array().unwrap();
                assert_eq!(actual.len(), values.len());
                for (actual, expected) in actual.iter().zip(values) {
                    assert_fields_preserved(actual, expected);
                }
            }
            _ => assert_eq!(actual, expected),
        }
    }

    fn assert_response<T: DeserializeOwned + Serialize>(name: &str) {
        for case in fixtures(name) {
            let parsed = serde_json::from_value::<T>(case.value.clone())
                .unwrap_or_else(|e| panic!("{name}/{}: {e}", case.name));
            assert_fields_preserved(&serde_json::to_value(parsed).unwrap(), &case.value);
        }
    }

    fn assert_requests(name: &str, actual: Vec<Value>) {
        let expected = fixtures(name);
        assert_eq!(
            actual.len(),
            expected.len(),
            "{name}: all cases must be serialized"
        );
        for (actual, case) in actual.into_iter().zip(expected) {
            assert_eq!(actual, case.value, "{name}/{}", case.name);
        }
    }

    #[test]
    fn response_task() {
        assert_response::<Task>("Task");
    }

    #[test]
    fn response_tasksresponse() {
        assert_response::<TasksResponse>("TasksResponse");
    }

    #[test]
    fn response_taskdetail() {
        assert_response::<TaskDetail>("TaskDetail");
    }

    #[test]
    fn response_approval() {
        assert_response::<Approval>("Approval");
    }

    #[test]
    fn response_approvalsresponse() {
        assert_response::<ApprovalsResponse>("ApprovalsResponse");
    }

    #[test]
    fn response_project() {
        assert_response::<Project>("Project");
    }

    #[test]
    fn response_projectwithgrants() {
        assert_response::<Project>("ProjectWithGrants");
    }

    #[test]
    fn response_projectsresponse() {
        assert_response::<ProjectsResponse>("ProjectsResponse");
    }

    #[test]
    fn response_memorysnapshot() {
        assert_response::<MemorySnapshot>("MemorySnapshot");
    }

    #[test]
    fn response_routine() {
        assert_response::<Routine>("Routine");
    }

    #[test]
    fn response_routineview() {
        assert_response::<RoutineView>("RoutineView");
    }

    #[test]
    fn response_routinesresponse() {
        assert_response::<RoutinesResponse>("RoutinesResponse");
    }

    #[test]
    fn response_routineoccurrence() {
        assert_response::<RoutineOccurrence>("RoutineOccurrence");
    }

    #[test]
    fn response_routinedetail() {
        for case in fixtures("RoutineDetail") {
            let detail: crate::api::RoutineDetail =
                serde_json::from_value(case.value.clone()).unwrap();
            let mut actual = serde_json::to_value(detail.view).unwrap();
            actual["occurrences"] = serde_json::to_value(detail.occurrences).unwrap();
            assert_fields_preserved(&actual, &case.value);
        }
    }

    #[test]
    fn response_assistantsettings() {
        assert_response::<AssistantSettings>("AssistantSettings");
    }

    #[test]
    fn response_destinationsresponse() {
        assert_response::<DestinationsResponse>("DestinationsResponse");
    }

    #[test]
    fn response_event() {
        assert_response::<Event>("Event");
    }

    #[test]
    fn request_createtaskrequest() {
        assert_requests(
            "CreateTaskRequest",
            vec![
                // required-only
                serde_json::to_value(CreateTaskRequest {
                    title: Some("Compare options".into()),
                    request: "Compare A and B".into(),
                    constraints: None,
                    startingUrls: None,
                    projectId: None,
                    kind: None,
                })
                .unwrap(),
                // all-optionals
                serde_json::to_value(CreateTaskRequest {
                    title: Some("Project update".into()),
                    request: "Summarize notes".into(),
                    constraints: Some("Use evidence".into()),
                    startingUrls: Some(vec!["https://example.com".into()]),
                    projectId: Some("p1".into()),
                    kind: Some(TaskKind::ProjectUpdate),
                })
                .unwrap(),
                // empty-optionals
                serde_json::to_value(CreateTaskRequest {
                    title: Some("Research".into()),
                    request: "Compare A and B".into(),
                    constraints: Some("".into()),
                    startingUrls: Some(vec![]),
                    projectId: None,
                    kind: Some(TaskKind::ResearchBrief),
                })
                .unwrap(),
            ],
        );
    }

    #[test]
    fn request_createprojectrequest() {
        assert_requests(
            "CreateProjectRequest",
            vec![
                // required-only
                serde_json::to_value(CreateProjectRequest {
                    name: "Demo".into(),
                    instructions: None,
                })
                .unwrap(),
                // instructions
                serde_json::to_value(CreateProjectRequest {
                    name: "Demo".into(),
                    instructions: Some("Use notes".into()),
                })
                .unwrap(),
                // empty-instructions
                serde_json::to_value(CreateProjectRequest {
                    name: "Demo".into(),
                    instructions: Some("".into()),
                })
                .unwrap(),
            ],
        );
    }

    #[test]
    fn request_updateprojectrequest() {
        assert_requests(
            "UpdateProjectRequest",
            vec![
                // empty
                serde_json::to_value(UpdateProjectRequest {
                    name: None,
                    instructions: None,
                })
                .unwrap(),
                // name-only
                serde_json::to_value(UpdateProjectRequest {
                    name: Some("Renamed".into()),
                    instructions: None,
                })
                .unwrap(),
                // all-fields
                serde_json::to_value(UpdateProjectRequest {
                    name: Some("Demo".into()),
                    instructions: Some("".into()),
                })
                .unwrap(),
            ],
        );
    }

    #[test]
    fn request_grantfolderrequest() {
        assert_requests(
            "GrantFolderRequest",
            vec![
                // path
                serde_json::to_value(GrantFolderRequest {
                    path: "C:/notes".into(),
                })
                .unwrap(),
            ],
        );
    }

    #[test]
    fn request_createexportrequest() {
        assert_requests(
            "CreateExportRequest",
            vec![
                // export
                serde_json::to_value(CreateExportRequest {
                    artifactId: "a1".into(),
                    destinationId: "d1".into(),
                    filename: "report.md".into(),
                })
                .unwrap(),
            ],
        );
    }

    #[test]
    fn request_exportdestinationrequest() {
        assert_requests(
            "ExportDestinationRequest",
            vec![
                // path
                serde_json::to_value(ExportDestinationRequest {
                    path: "C:/exports".into(),
                })
                .unwrap(),
            ],
        );
    }

    #[test]
    fn request_grantdecision() {
        assert_requests(
            "GrantDecision",
            vec![
                // granted
                serde_json::to_value(GrantDecision {
                    decision: "granted".into(),
                })
                .unwrap(),
                // rejected
                serde_json::to_value(GrantDecision {
                    decision: "rejected".into(),
                })
                .unwrap(),
            ],
        );
    }

    #[test]
    fn request_createroutinerequest() {
        assert_requests(
            "CreateRoutineRequest",
            vec![
                // weekly-paused
                serde_json::to_value(CreateRoutineRequest {
                    name: "Friday planning".into(),
                    projectId: "p1".into(),
                    timezone: "Asia/Kolkata".into(),
                    schedule: RoutineSchedule::Weekly {
                        weekday: 5,
                        time: "09:00".into(),
                    },
                    template: RoutineTemplate {
                        title: "Weekly plan".into(),
                        request: "Draft priorities".into(),
                        constraints: None,
                    },
                })
                .unwrap(),
                // daily-active
                serde_json::to_value(CreateRoutineRequest {
                    name: "Friday planning".into(),
                    projectId: "p1".into(),
                    timezone: "Asia/Kolkata".into(),
                    schedule: RoutineSchedule::Daily {
                        time: "18:30".into(),
                    },
                    template: RoutineTemplate {
                        title: "Weekly plan".into(),
                        request: "Draft priorities".into(),
                        constraints: Some("Focus on next week".into()),
                    },
                })
                .unwrap(),
            ],
        );
    }

    #[test]
    fn request_updateroutinerequest() {
        assert_requests(
            "UpdateRoutineRequest",
            vec![
                // name-only
                serde_json::to_value(UpdateRoutineRequest {
                    name: Some("Renamed".into()),
                    projectId: None,
                    timezone: None,
                    schedule: None,
                    template: None,
                })
                .unwrap(),
                // all-fields
                serde_json::to_value(UpdateRoutineRequest {
                    name: Some("Daily planning".into()),
                    projectId: Some("p1".into()),
                    timezone: Some("UTC".into()),
                    schedule: Some(RoutineSchedule::Daily {
                        time: "18:30".into(),
                    }),
                    template: Some(RoutineTemplate {
                        title: "Weekly plan".into(),
                        request: "Draft priorities".into(),
                        constraints: Some("Focus".into()),
                    }),
                })
                .unwrap(),
                // weekly-schedule
                serde_json::to_value(UpdateRoutineRequest {
                    name: None,
                    projectId: None,
                    timezone: None,
                    schedule: Some(RoutineSchedule::Weekly {
                        weekday: 5,
                        time: "09:00".into(),
                    }),
                    template: None,
                })
                .unwrap(),
            ],
        );
    }

    #[test]
    fn request_setproviderconfigrequest() {
        assert_requests(
            "SetProviderConfigRequest",
            vec![
                // openai-omitted
                serde_json::to_value(SetProviderConfigRequest::<String> {
                    provider: "openai".into(),
                    model: None,
                })
                .unwrap(),
                // gemini-omitted
                serde_json::to_value(SetProviderConfigRequest::<String> {
                    provider: "gemini".into(),
                    model: None,
                })
                .unwrap(),
                // openrouter-omitted
                serde_json::to_value(SetProviderConfigRequest::<String> {
                    provider: "openrouter".into(),
                    model: None,
                })
                .unwrap(),
                // model
                serde_json::to_value(SetProviderConfigRequest::<String> {
                    provider: "openai".into(),
                    model: Some("gpt-4o-mini".into()),
                })
                .unwrap(),
                // reset-model
                serde_json::to_value(SetProviderConfigRequest::<Option<String>> {
                    provider: "openai".into(),
                    model: Some(None),
                })
                .unwrap(),
            ],
        );
    }

    #[test]
    fn request_setproviderkeyrequest() {
        assert_requests(
            "SetProviderKeyRequest",
            vec![
                // openai
                serde_json::to_value(SetProviderKeyRequest {
                    provider: "openai".into(),
                    key: "fixture-only-not-a-real-key".into(),
                })
                .unwrap(),
                // gemini
                serde_json::to_value(SetProviderKeyRequest {
                    provider: "gemini".into(),
                    key: "fixture-only-not-a-real-key".into(),
                })
                .unwrap(),
                // openrouter
                serde_json::to_value(SetProviderKeyRequest {
                    provider: "openrouter".into(),
                    key: "fixture-only-not-a-real-key".into(),
                })
                .unwrap(),
            ],
        );
    }

    #[test]
    fn request_approvememoryproposalrequest() {
        assert_requests(
            "ApproveMemoryProposalRequest",
            vec![
                // new-file
                serde_json::to_value(ApproveMemoryProposalRequest {
                    content: None,
                    fileSha256: None,
                })
                .unwrap(),
                // existing-file
                serde_json::to_value(ApproveMemoryProposalRequest {
                    content: None,
                    fileSha256: Some(
                        "0000000000000000000000000000000000000000000000000000000000000000".into(),
                    ),
                })
                .unwrap(),
                // edited
                serde_json::to_value(ApproveMemoryProposalRequest {
                    content: Some("Edited preference".into()),
                    fileSha256: Some(
                        "0000000000000000000000000000000000000000000000000000000000000000".into(),
                    ),
                })
                .unwrap(),
                // empty-edit
                serde_json::to_value(ApproveMemoryProposalRequest {
                    content: Some("".into()),
                    fileSha256: None,
                })
                .unwrap(),
            ],
        );
    }

    #[test]
    fn request_updatememoryentryrequest() {
        assert_requests(
            "UpdateMemoryEntryRequest",
            vec![
                // edit
                serde_json::to_value(UpdateMemoryEntryRequest {
                    content: "Edited preference".into(),
                    fileSha256: "0000000000000000000000000000000000000000000000000000000000000000"
                        .into(),
                })
                .unwrap(),
            ],
        );
    }

    #[test]
    fn request_deletememoryentryrequest() {
        assert_requests(
            "DeleteMemoryEntryRequest",
            vec![
                // version
                serde_json::to_value(DeleteMemoryEntryRequest {
                    fileSha256: "0000000000000000000000000000000000000000000000000000000000000000"
                        .into(),
                })
                .unwrap(),
            ],
        );
    }

    #[test]
    fn all_enum_variants_match_shared_fixture() {
        let raw = std::fs::read_to_string(fixture_dir().join("enums.json")).unwrap();
        let expected: serde_json::Map<String, Value> = serde_json::from_str(&raw).unwrap();
        macro_rules! variants {
            ($ty:ident, [$($variant:ident),+]) => {{
                let actual = vec![$($ty::$variant),+];
                let value = serde_json::to_value(&actual).unwrap();
                assert_eq!(value, expected[stringify!($ty)], stringify!($ty));
                for variant in value.as_array().unwrap() {
                    serde_json::from_value::<$ty>(variant.clone()).unwrap();
                }
                assert!(serde_json::from_value::<$ty>(Value::String("unknown_variant".into())).is_err());
            }};
        }
        variants!(
            TaskState,
            [
                Queued,
                Running,
                AwaitingApproval,
                Completed,
                Failed,
                Canceled,
                Interrupted
            ]
        );
        variants!(
            TaskKind,
            [ResearchBrief, ProjectUpdate, ExportReport, WeeklyPlan]
        );
        variants!(
            RunState,
            [Running, Completed, Failed, Canceled, Interrupted]
        );
        variants!(RunLimitKind, [MaxSteps, WallClock, MaxInput, MaxOutput]);
        variants!(
            ApprovalState,
            [Pending, Granted, Rejected, Canceled, Expired, Executed]
        );
        variants!(RiskTier, [Auto, Telegram, Local]);
        variants!(MemoryScope, [Global, Project]);
        variants!(ProviderId, [Openai, Gemini, Openrouter]);
        variants!(RoutineState, [Active, Paused]);
        variants!(RoutineOccurrenceState, [Scheduled, Missed, Skipped]);
        variants!(MemoryProposalState, [Pending, Approved, Rejected]);
        assert_eq!(expected.len(), 11);
    }

    #[test]
    fn every_fixture_file_is_registered() {
        let mut actual: Vec<String> = std::fs::read_dir(fixture_dir())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".json"))
            .collect();
        let mut expected: Vec<String> = vec![
            "Task",
            "TasksResponse",
            "TaskDetail",
            "Approval",
            "ApprovalsResponse",
            "Project",
            "ProjectWithGrants",
            "ProjectsResponse",
            "MemorySnapshot",
            "Routine",
            "RoutineView",
            "RoutinesResponse",
            "RoutineOccurrence",
            "RoutineDetail",
            "AssistantSettings",
            "DestinationsResponse",
            "Event",
            "CreateTaskRequest",
            "CreateProjectRequest",
            "UpdateProjectRequest",
            "GrantFolderRequest",
            "CreateExportRequest",
            "ExportDestinationRequest",
            "GrantDecision",
            "CreateRoutineRequest",
            "UpdateRoutineRequest",
            "SetProviderConfigRequest",
            "SetProviderKeyRequest",
            "ApproveMemoryProposalRequest",
            "UpdateMemoryEntryRequest",
            "DeleteMemoryEntryRequest",
            "enums",
        ]
        .into_iter()
        .map(|name| format!("{name}.json"))
        .collect();
        actual.sort();
        expected.sort();
        assert_eq!(actual, expected);
    }

    #[test]
    fn missing_required_task_title_fails_serialization() {
        let input = CreateTaskRequest {
            request: "Compare A and B".into(),
            ..Default::default()
        };
        assert!(serde_json::to_value(input)
            .unwrap_err()
            .to_string()
            .contains("title is required"));
    }
}
