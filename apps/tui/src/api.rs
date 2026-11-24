//! Loopback API client. The TUI is a thin client of the existing Fastify
//! API on 127.0.0.1. Loopback binding and the API's origin guard are the
//! local trust boundary; the API validates and enforces everything else.

use anyhow::{Context, Result};
use reqwest::{Client, Method, StatusCode};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

use crate::contracts::*;

/// Errors surface as messages the TUI can show directly.
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("The API rejected the request ({status}): {message}")]
    Response { status: u16, message: String },
    #[error(transparent)]
    Transport(#[from] reqwest::Error),
}

impl ApiError {
    pub fn message(&self) -> String {
        self.to_string()
    }
}

/// Cheaply cloneable handle to the loopback API. `reqwest::Client` is
/// `Clone + Send + Sync`, so concurrent tasks each hold their own clone and
/// never serialize HTTP round-trips behind a lock.
#[derive(Clone)]
pub struct ApiClient {
    http: Client,
    /// Same pool settings as `http`, but with no total-request timeout so a
    /// long-lived SSE response is not cut off every 30 seconds.
    stream_http: Client,
    base_url: String,
}

/// Extract the API's human-readable error body: `{ "error": "..." }`.
fn error_message(status: StatusCode, body: String) -> ApiError {
    let message = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|value| {
            value
                .get("error")
                .and_then(|error| error.as_str().map(str::to_string))
        })
        .unwrap_or_else(|| {
            if body.is_empty() {
                status
                    .canonical_reason()
                    .unwrap_or("request failed")
                    .to_string()
            } else {
                body.chars().take(300).collect()
            }
        });
    ApiError::Response {
        status: status.as_u16(),
        message,
    }
}

impl ApiClient {
    pub fn new(base_url: &str) -> Result<Self> {
        // Validate the URL up front so a typo fails fast, not on first request.
        let parsed = url::Url::parse(base_url).context("Invalid API base URL")?;
        anyhow::ensure!(
            matches!(parsed.scheme(), "http" | "https"),
            "API base URL must be http(s)"
        );
        let http = Client::builder().timeout(Duration::from_secs(30)).build()?;
        // The API sends an SSE heartbeat comment every 15 s; a 45 s per-read
        // timeout detects silent half-open connections. event::subscribe_events
        // separately rotates healthy streams on a fixed lifetime so heartbeats
        // cannot keep a half-open connection alive indefinitely.
        let stream_http = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .read_timeout(Duration::from_secs(45))
            .build()?;
        Ok(Self {
            http,
            stream_http,
            base_url: base_url.trim_end_matches('/').to_string(),
        })
    }

    /// Client for the long-lived SSE stream: no total request timeout, and a
    /// 45 s per-read timeout (3x the API's 15 s heartbeat) so a silent
    /// half-open connection drops and reconnects. The subscriber also rotates
    /// healthy streams on a fixed lifetime.
    pub fn stream_http(&self) -> Client {
        self.stream_http.clone()
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    async fn send<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        body: Option<&impl Serialize>,
    ) -> Result<T, ApiError> {
        let mut request = self.http.request(method, self.url(path));
        if let Some(payload) = body {
            request = request.json(payload);
        }
        let response = request.send().await?;
        let status = response.status();
        let text = response.text().await?;
        if !status.is_success() {
            return Err(error_message(status, text));
        }
        if text.is_empty() {
            // 204-style responses; callers that need a payload use typed
            // endpoints instead.
            return Err(ApiError::Response {
                status: status.as_u16(),
                message: "unexpected empty response".into(),
            });
        }
        serde_json::from_str(&text).map_err(|error| ApiError::Response {
            status: status.as_u16(),
            message: format!("unexpected response shape: {error}"),
        })
    }

    async fn send_empty(&self, method: Method, path: &str) -> Result<(), ApiError> {
        let response = self.http.request(method, self.url(path)).send().await?;
        let status = response.status();
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(error_message(status, text));
        }
        Ok(())
    }

    // -- Reachability -------------------------------------------------------

    /// `GET /health` probe used on startup and while retrying `Connecting`.
    pub async fn health(&self) -> Result<bool, ApiError> {
        let text = self
            .http
            .get(self.url("/health"))
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;
        let value: serde_json::Value =
            serde_json::from_str(&text).map_err(|_| ApiError::Response {
                status: 200,
                message: "unexpected /health response".into(),
            })?;
        Ok(value.get("ok").and_then(Value::as_bool).unwrap_or(false))
    }

    // -- Tasks --------------------------------------------------------------

    pub async fn tasks(&self) -> Result<TasksResponse, ApiError> {
        self.send(Method::GET, "/api/tasks", None::<&()>).await
    }

    pub async fn task_detail(&self, task_id: &str) -> Result<TaskDetail, ApiError> {
        self.send(Method::GET, &format!("/api/tasks/{task_id}"), None::<&()>)
            .await
    }

    pub async fn create_task(&self, input: &CreateTaskRequest) -> Result<Task, ApiError> {
        let response: serde_json::Value =
            self.send(Method::POST, "/api/tasks", Some(input)).await?;
        parse_field(&response, "task")
    }

    pub async fn cancel_task(&self, task_id: &str) -> Result<Task, ApiError> {
        let response: serde_json::Value = self
            .send(
                Method::POST,
                &format!("/api/tasks/{task_id}/cancel"),
                None::<&()>,
            )
            .await?;
        parse_field(&response, "task")
    }

    pub async fn retry_task(&self, task_id: &str) -> Result<Task, ApiError> {
        let response: serde_json::Value = self
            .send(
                Method::POST,
                &format!("/api/tasks/{task_id}/retry"),
                None::<&()>,
            )
            .await?;
        parse_field(&response, "task")
    }

    // -- Dispatch -----------------------------------------------------------

    pub async fn resume_dispatch(&self) -> Result<(), ApiError> {
        self.send_empty(Method::POST, "/api/dispatch/resume").await
    }

    // -- Events -------------------------------------------------------------

    pub async fn events(&self, limit: u32) -> Result<Vec<Event>, ApiError> {
        let response: serde_json::Value = self
            .send(
                Method::GET,
                &format!("/api/events?limit={limit}"),
                None::<&()>,
            )
            .await?;
        parse_field(&response, "events")
    }

    // -- Approvals and exports ----------------------------------------------

    pub async fn pending_approvals(&self) -> Result<Vec<ApprovalView>, ApiError> {
        let response: ApprovalsResponse = self
            .send(Method::GET, "/api/approvals?state=pending", None::<&()>)
            .await?;
        Ok(response.approvals)
    }

    pub async fn decide_approval(
        &self,
        approval_id: &str,
        decision: &str,
    ) -> Result<Approval, ApiError> {
        let body = GrantDecision {
            decision: decision.to_string(),
        };
        let response: serde_json::Value = self
            .send(
                Method::POST,
                &format!("/api/approvals/{approval_id}/decision"),
                Some(&body),
            )
            .await?;
        parse_field(&response, "approval")
    }

    pub async fn destinations(&self) -> Result<Vec<ExportDestination>, ApiError> {
        let response: DestinationsResponse = self
            .send(Method::GET, "/api/exports/destinations", None::<&()>)
            .await?;
        Ok(response.destinations)
    }

    pub async fn add_destination(&self, path: &str) -> Result<ExportDestination, ApiError> {
        let body = ExportDestinationRequest {
            path: path.to_string(),
        };
        let response: serde_json::Value = self
            .send(Method::POST, "/api/exports/destinations", Some(&body))
            .await?;
        parse_field(&response, "destination")
    }

    pub async fn remove_destination(&self, destination_id: &str) -> Result<(), ApiError> {
        self.send_empty(
            Method::DELETE,
            &format!("/api/exports/destinations/{destination_id}"),
        )
        .await
    }

    pub async fn request_export(&self, input: &CreateExportRequest) -> Result<Task, ApiError> {
        let response: serde_json::Value =
            self.send(Method::POST, "/api/exports", Some(input)).await?;
        parse_field(&response, "task")
    }

    // -- Projects -----------------------------------------------------------

    pub async fn projects(&self) -> Result<Vec<Project>, ApiError> {
        let response: ProjectsResponse =
            self.send(Method::GET, "/api/projects", None::<&()>).await?;
        Ok(response.projects)
    }

    pub async fn create_project(&self, input: &CreateProjectRequest) -> Result<Project, ApiError> {
        let response: serde_json::Value = self
            .send(Method::POST, "/api/projects", Some(input))
            .await?;
        parse_field(&response, "project")
    }

    pub async fn update_project(
        &self,
        project_id: &str,
        input: &UpdateProjectRequest,
    ) -> Result<Project, ApiError> {
        let response: serde_json::Value = self
            .send(
                Method::PUT,
                &format!("/api/projects/{project_id}"),
                Some(input),
            )
            .await?;
        parse_field(&response, "project")
    }

    pub async fn grant_folder(
        &self,
        project_id: &str,
        path: &str,
    ) -> Result<ProjectFolderGrant, ApiError> {
        let body = GrantFolderRequest {
            path: path.to_string(),
        };
        let response: serde_json::Value = self
            .send(
                Method::POST,
                &format!("/api/projects/{project_id}/grants"),
                Some(&body),
            )
            .await?;
        parse_field(&response, "grant")
    }

    pub async fn revoke_folder(&self, project_id: &str, grant_id: &str) -> Result<(), ApiError> {
        self.send_empty(
            Method::DELETE,
            &format!("/api/projects/{project_id}/grants/{grant_id}"),
        )
        .await
    }

    // -- Memory ---------------------------------------------------------------

    pub async fn memory(&self) -> Result<MemorySnapshot, ApiError> {
        self.send(Method::GET, "/api/memory", None::<&()>).await
    }

    pub async fn approve_memory_proposal(
        &self,
        proposal_id: &str,
        input: &ApproveMemoryProposalRequest,
    ) -> Result<(), ApiError> {
        self.send_ack(
            Method::POST,
            &format!("/api/memory/proposals/{proposal_id}/approve"),
            Some(input),
        )
        .await
    }

    pub async fn reject_memory_proposal(&self, proposal_id: &str) -> Result<(), ApiError> {
        self.send_ack(
            Method::POST,
            &format!("/api/memory/proposals/{proposal_id}/reject"),
            None::<&()>,
        )
        .await
    }

    pub async fn update_memory_entry(
        &self,
        entry_id: &str,
        input: &UpdateMemoryEntryRequest,
    ) -> Result<(), ApiError> {
        self.send_ack(
            Method::PUT,
            &format!("/api/memory/entries/{entry_id}"),
            Some(input),
        )
        .await
    }

    pub async fn delete_memory_entry(
        &self,
        entry_id: &str,
        input: &DeleteMemoryEntryRequest,
    ) -> Result<(), ApiError> {
        self.send_ack(
            Method::DELETE,
            &format!("/api/memory/entries/{entry_id}"),
            Some(input),
        )
        .await
    }

    pub async fn reload_memory(&self) -> Result<(), ApiError> {
        self.send_ack(Method::POST, "/api/memory/reload", None::<&()>)
            .await
    }

    // -- Routines -------------------------------------------------------------

    pub async fn routines(&self) -> Result<Vec<RoutineView>, ApiError> {
        let response: RoutinesResponse =
            self.send(Method::GET, "/api/routines", None::<&()>).await?;
        Ok(response.routines)
    }

    pub async fn routine_detail(&self, routine_id: &str) -> Result<RoutineDetail, ApiError> {
        self.send(
            Method::GET,
            &format!("/api/routines/{routine_id}"),
            None::<&()>,
        )
        .await
    }

    pub async fn create_routine(&self, input: &CreateRoutineRequest) -> Result<Routine, ApiError> {
        let response: serde_json::Value = self
            .send(Method::POST, "/api/routines", Some(input))
            .await?;
        parse_field(&response, "routine")
    }

    pub async fn update_routine(
        &self,
        routine_id: &str,
        input: &UpdateRoutineRequest,
    ) -> Result<Routine, ApiError> {
        let response: serde_json::Value = self
            .send(
                Method::PUT,
                &format!("/api/routines/{routine_id}"),
                Some(input),
            )
            .await?;
        parse_field(&response, "routine")
    }

    pub async fn delete_routine(&self, routine_id: &str) -> Result<(), ApiError> {
        self.send_empty(Method::DELETE, &format!("/api/routines/{routine_id}"))
            .await
    }

    pub async fn enable_routine(&self, routine_id: &str) -> Result<Routine, ApiError> {
        let response: serde_json::Value = self
            .send(
                Method::POST,
                &format!("/api/routines/{routine_id}/enable"),
                None::<&()>,
            )
            .await?;
        parse_field(&response, "routine")
    }

    pub async fn pause_routine(&self, routine_id: &str) -> Result<Routine, ApiError> {
        let response: serde_json::Value = self
            .send(
                Method::POST,
                &format!("/api/routines/{routine_id}/pause"),
                None::<&()>,
            )
            .await?;
        parse_field(&response, "routine")
    }

    pub async fn run_occurrence_now(
        &self,
        routine_id: &str,
        occurrence_key: &str,
    ) -> Result<RoutineOccurrence, ApiError> {
        let response: serde_json::Value = self
            .send(
                Method::POST,
                &format!("/api/routines/{routine_id}/occurrences/{occurrence_key}/run"),
                None::<&()>,
            )
            .await?;
        parse_field(&response, "occurrence")
    }

    pub async fn skip_occurrence(
        &self,
        routine_id: &str,
        occurrence_key: &str,
    ) -> Result<RoutineOccurrence, ApiError> {
        let response: serde_json::Value = self
            .send(
                Method::POST,
                &format!("/api/routines/{routine_id}/occurrences/{occurrence_key}/skip"),
                None::<&()>,
            )
            .await?;
        parse_field(&response, "occurrence")
    }

    // -- Settings ---------------------------------------------------------------

    pub async fn settings(&self) -> Result<AssistantSettings, ApiError> {
        self.send(Method::GET, "/api/settings", None::<&()>).await
    }

    pub async fn set_provider(&self, input: &SetProviderConfigRequest) -> Result<(), ApiError> {
        self.send_ack(Method::PUT, "/api/settings/provider", Some(input))
            .await
    }

    pub async fn set_provider_key(&self, input: &SetProviderKeyRequest) -> Result<(), ApiError> {
        self.send_ack(Method::PUT, "/api/settings/provider-key", Some(input))
            .await
    }

    pub async fn remove_provider_key(&self, provider: &str) -> Result<(), ApiError> {
        self.send_empty(
            Method::DELETE,
            &format!("/api/settings/provider-key?provider={provider}"),
        )
        .await
    }

    /// POST/PUT/DELETE endpoints whose payload the TUI does not need; the
    /// response body is still parsed to surface API errors with real messages.
    async fn send_ack(
        &self,
        method: Method,
        path: &str,
        body: Option<&impl Serialize>,
    ) -> Result<(), ApiError> {
        let _: serde_json::Value = self.send(method, path, body).await?;
        Ok(())
    }
}

fn parse_field<T: DeserializeOwned>(
    response: &serde_json::Value,
    field: &str,
) -> Result<T, ApiError> {
    serde_json::from_value(response.get(field).cloned().unwrap_or(Value::Null)).map_err(|error| {
        ApiError::Response {
            status: 200,
            message: format!("unexpected response shape for '{field}': {error}"),
        }
    })
}

/// Occurrence rows on the routine detail endpoint carry their dispatched task.
#[derive(Debug, Clone, Deserialize)]
pub struct RoutineDetail {
    #[serde(flatten)]
    pub view: RoutineView,
    pub occurrences: Vec<RoutineOccurrence>,
}
