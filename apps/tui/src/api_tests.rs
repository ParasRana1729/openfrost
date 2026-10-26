//! API client tests against a local mock HTTP server. No real API, no
//! credentials, no paid calls (repo testing rule 3).

use httpmock::MockServer;

use crate::api::ApiClient;
use crate::contracts::*;

fn client(server: &MockServer) -> ApiClient {
    ApiClient::new(&server.base_url()).expect("valid base URL")
}

const TASK_JSON: &str = r#"{ "id": "t1", "title": "T", "request": "R", "constraints": null, "startingUrls": null, "projectId": null, "kind": "research_brief", "exportArgs": null, "routineId": null, "state": "queued", "attemptCount": 0, "lastRunId": null, "resultArtifactId": null, "error": null, "createdAt": "2026-10-26T00:00:00.000Z", "updatedAt": "2026-10-26T00:00:00.000Z" }"#;
const CANCELED_TASK_JSON: &str = r#"{ "id": "t1", "title": "T", "request": "R", "constraints": null, "startingUrls": null, "projectId": null, "kind": "research_brief", "exportArgs": null, "routineId": null, "state": "canceled", "attemptCount": 0, "lastRunId": null, "resultArtifactId": null, "error": null, "createdAt": "2026-10-26T00:00:00.000Z", "updatedAt": "2026-10-26T00:00:00.000Z" }"#;
const GRANTED_APPROVAL_JSON: &str = r#"{ "approval": { "id": "ap1", "taskId": "t1", "runId": "r1", "action": "export_file", "artifactId": "a1", "destinationId": "d1", "destinationPath": "C:\\x", "filename": "report.md", "contentSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "riskTier": "telegram", "state": "granted", "requestedAt": "2026-10-26T00:00:00.000Z", "expiresAt": "2026-10-27T00:00:00.000Z", "decidedAt": "2026-10-26T00:05:00.000Z", "executedAt": null, "outcome": null, "refusalReason": null } }"#;

#[tokio::test]
async fn health_reports_ok() {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(httpmock::Method::GET).path("/health");
        then.status(200).body(r#"{ "ok": true }"#);
    });
    let client = client(&server);
    assert!(client.health().await.unwrap());
}

#[tokio::test]
async fn login_stores_csrf_token_and_sends_it_on_mutations() {
    let server = MockServer::start();

    server.mock(|when, then| {
        when.method(httpmock::Method::POST)
            .path("/api/auth/login")
            .body(r#"{"password":"hunter2hunter2"}"#);
        then.status(200)
            .header("set-cookie", "openfrost_session=sid123; Path=/")
            .body(r#"{ "authenticated": true, "csrfToken": "csrf-1" }"#);
    });

    let mut client = client(&server);
    let success = client.login("hunter2hunter2").await.unwrap();
    assert_eq!(success.csrfToken, "csrf-1");
    assert_eq!(client.csrf_token(), Some("csrf-1"));

    // A mutation must carry the session's CSRF token header; the API enforces it.
    server.mock(|when, then| {
        when.method(httpmock::Method::POST)
            .path("/api/tasks/t1/cancel")
            .header("x-csrf-token", "csrf-1");
        then.status(200)
            .body(format!(r#"{{ "task": {CANCELED_TASK_JSON} }}"#));
    });
    client.cancel_task("t1").await.unwrap();
}

#[tokio::test]
async fn mutation_without_csrf_is_rejected_by_the_mock_like_the_api() {
    let server = MockServer::start();
    // The client has no session here, so it sends no CSRF header — exactly
    // what the real API answers with 403.
    server.mock(|when, then| {
        when.method(httpmock::Method::POST)
            .path("/api/tasks/t1/cancel");
        then.status(403)
            .body(r#"{ "error": "CSRF token missing or invalid" }"#);
    });
    let client = client(&server);
    let error = client.cancel_task("t1").await.unwrap_err();
    assert!(error.message().contains("CSRF"), "got: {error}");
}

#[tokio::test]
async fn api_error_bodies_surface_their_message() {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(httpmock::Method::POST).path("/api/auth/login");
        then.status(401)
            .body(r#"{ "error": "Invalid username or password" }"#);
    });
    let mut client = client(&server);
    let error = client.login("nope").await.unwrap_err();
    assert_eq!(
        error.message(),
        "The API rejected the request (401): Invalid username or password"
    );
}

#[tokio::test]
async fn tasks_list_parses_executor_status() {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(httpmock::Method::GET).path("/api/tasks");
        then.status(200).body(
            r#"{ "tasks": [], "executor": { "busy": false, "activeTaskId": null, "dispatchPaused": true } }"#,
        );
    });
    let client = client(&server);
    let response = client.tasks().await.unwrap();
    assert!(response.executor.dispatchPaused);
}

#[tokio::test]
async fn create_task_sends_only_declared_fields() {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(httpmock::Method::POST)
            .path("/api/tasks")
            // strictObject on the API rejects unknown keys; the request must
            // carry exactly the declared, set fields.
            .body(r#"{"request":"Compare A and B","kind":"research_brief"}"#);
        then.status(202).body(format!(
            r#"{{ "task": {} }}"#,
            TASK_JSON.replace("t1", "t9")
        ));
    });
    let client = client(&server);
    let input = CreateTaskRequest {
        title: None,
        request: "Compare A and B".into(),
        constraints: None,
        startingUrls: None,
        projectId: None,
        kind: Some(TaskKind::ResearchBrief),
    };
    let task = client.create_task(&input).await.unwrap();
    assert_eq!(task.id, "t9");
}

#[tokio::test]
async fn task_detail_returns_full_shape() {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(httpmock::Method::GET).path("/api/tasks/t1");
        then.status(200).body(
            r##"{ "task": { "id": "t1", "title": "T", "request": "R", "constraints": null, "startingUrls": null, "projectId": null, "kind": "research_brief", "exportArgs": null, "routineId": null, "state": "completed", "attemptCount": 1, "lastRunId": "r1", "resultArtifactId": "a1", "error": null, "createdAt": "2026-10-26T00:00:00.000Z", "updatedAt": "2026-10-26T00:01:00.000Z" },
                 "runs": [], "events": [],
                 "artifact": { "id": "a1", "markdown": "# Hi" },
                 "approval": null }"##,
        );
    });
    let client = client(&server);
    let detail = client.task_detail("t1").await.unwrap();
    assert_eq!(detail.artifact.unwrap().markdown, "# Hi");
}

#[tokio::test]
async fn approval_decision_sends_the_body() {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(httpmock::Method::POST)
            .path("/api/approvals/ap1/decision")
            .header("x-csrf-token", "tok")
            .body(r#"{"decision":"granted"}"#);
        then.status(200).body(GRANTED_APPROVAL_JSON);
    });
    let mut client = client(&server);
    client.set_csrf_token(Some("tok".into()));
    let approval = client.decide_approval("ap1", "granted").await.unwrap();
    assert_eq!(approval.state, ApprovalState::Granted);
}

#[tokio::test]
async fn delete_destination_uses_delete_verb() {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(httpmock::Method::DELETE)
            .path("/api/exports/destinations/d1");
        then.status(204);
    });
    let mut client = client(&server);
    client.set_csrf_token(Some("tok".into()));
    client.remove_destination("d1").await.unwrap();
}

#[tokio::test]
async fn memory_and_settings_round_trip() {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(httpmock::Method::GET).path("/api/memory");
        then.status(200).body(
            r#"{ "global": { "scope": "global", "projectId": null, "path": "C:\\m.md", "exists": false, "sha256": null, "entries": [], "problems": [], "externalChange": false },
                 "projects": [], "proposals": [],
                 "limits": { "contentMaxChars": 4000, "entriesPerFile": 50, "contextMaxChars": 6000 } }"#,
        );
    });
    server.mock(|when, then| {
        when.method(httpmock::Method::PUT)
            .path("/api/settings/provider")
            .header("x-csrf-token", "tok");
        then.status(200)
            .body(r#"{ "ok": true, "provider": "openai" }"#);
    });
    let mut client = client(&server);
    client.set_csrf_token(Some("tok".into()));
    let snapshot = client.memory().await.unwrap();
    assert_eq!(snapshot.limits.contentMaxChars, 4000);
    client
        .set_provider(&SetProviderConfigRequest {
            provider: "openai".into(),
            model: None,
        })
        .await
        .unwrap();
}
