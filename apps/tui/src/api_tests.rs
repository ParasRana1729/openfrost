//! API client tests against a local mock HTTP server. No real API, no
//! credentials, no paid calls (repo testing rule 3).

use std::time::{Duration, Instant};

use httpmock::MockServer;

use crate::api::ApiClient;
use crate::contracts::*;
use crate::event::Payload;
use crate::refresh::{load_assistant_data, load_settings_bundle, load_tasks};

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

    let client = client(&server);
    let success = client.login("hunter2hunter2").await.unwrap();
    assert_eq!(success.csrfToken, "csrf-1");
    assert_eq!(client.csrf_token(), Some("csrf-1".to_string()));

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
    let client = client(&server);
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
            .body(r#"{"title":"Compare options","request":"Compare A and B","kind":"research_brief"}"#);
        then.status(202).body(format!(
            r#"{{ "task": {} }}"#,
            TASK_JSON.replace("t1", "t9")
        ));
    });
    let client = client(&server);
    let input = CreateTaskRequest {
        title: Some("Compare options".into()),
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
    let client = client(&server);
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
    let client = client(&server);
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
    let client = client(&server);
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

// ---------------------------------------------------------------------------
// Shared, lock-free client: concurrency and CSRF propagation across clones
// ---------------------------------------------------------------------------

const DETAIL_JSON: &str = r##"{ "task": { "id": "t1", "title": "T", "request": "R", "constraints": null, "startingUrls": null, "projectId": null, "kind": "research_brief", "exportArgs": null, "routineId": null, "state": "completed", "attemptCount": 1, "lastRunId": "r1", "resultArtifactId": "a1", "error": null, "createdAt": "2026-10-26T00:00:00.000Z", "updatedAt": "2026-10-26T00:01:00.000Z" },
    "runs": [], "events": [], "artifact": { "id": "a1", "markdown": "# Hi" }, "approval": null }"##;
const IDLE_EXECUTOR: &str =
    r#""executor": { "busy": false, "activeTaskId": null, "dispatchPaused": false }"#;
const SETTINGS_JSON: &str = r#"{
    "provider": "openrouter", "model": "free/model",
    "models": { "openai": "gpt-4o-mini", "gemini": "gemini-2.0-flash", "openrouter": "free/model" },
    "hasProviderKey": true, "hasOpenAIKey": false, "hasGeminiKey": false, "hasOpenRouterKey": true,
    "executionLimits": { "maxSteps": 12, "maxWallClockMs": 600000, "maxInputChars": 20000, "maxOutputChars": 100000 },
    "onboardingCompletedAt": null
}"#;

fn delayed_get<'a>(
    server: &'a MockServer,
    path: &str,
    delay_ms: u64,
    body: String,
) -> httpmock::Mock<'a> {
    server.mock(|when, then| {
        when.method(httpmock::Method::GET).path(path);
        then.status(200)
            .delay(Duration::from_millis(delay_ms))
            .body(body);
    })
}

#[tokio::test]
async fn a_slow_request_does_not_block_other_clones() {
    let server = MockServer::start();
    let slow = delayed_get(
        &server,
        "/api/tasks",
        700,
        format!(r#"{{ "tasks": [], {IDLE_EXECUTOR} }}"#),
    );
    server.mock(|when, then| {
        when.method(httpmock::Method::GET).path("/health");
        then.status(200).body(r#"{ "ok": true }"#);
    });
    let a = client(&server);
    let b = a.clone();

    // With the old global mutex held across .await, `b` queued behind `a`'s
    // whole 700 ms round-trip.
    let in_flight = tokio::spawn(async move { a.tasks().await });
    tokio::time::sleep(Duration::from_millis(100)).await;
    let started = Instant::now();
    assert!(b.health().await.unwrap());
    assert!(
        started.elapsed() < Duration::from_millis(400),
        "health waited {:?} behind an unrelated slow request",
        started.elapsed()
    );
    in_flight.await.unwrap().unwrap();
    slow.assert();
}

#[tokio::test]
async fn independent_reads_overlap_instead_of_serializing() {
    let server = MockServer::start();
    delayed_get(&server, "/api/settings", 400, SETTINGS_JSON.to_string());
    delayed_get(
        &server,
        "/api/exports/destinations",
        400,
        r#"{ "destinations": [] }"#.to_string(),
    );
    let api = client(&server);

    let started = Instant::now();
    let (settings, destinations) = tokio::join!(api.settings(), api.destinations());
    let elapsed = started.elapsed();
    settings.unwrap();
    destinations.unwrap();
    // Serial would be >= 800 ms.
    assert!(elapsed < Duration::from_millis(700), "took {elapsed:?}");
}

#[tokio::test]
async fn csrf_token_set_by_login_is_visible_to_every_clone() {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(httpmock::Method::POST).path("/api/auth/login");
        then.status(200)
            .body(r#"{ "authenticated": true, "csrfToken": "csrf-shared" }"#);
    });
    let cancel = server.mock(|when, then| {
        when.method(httpmock::Method::POST)
            .path("/api/tasks/t1/cancel")
            .header("x-csrf-token", "csrf-shared");
        then.status(200)
            .body(format!(r#"{{ "task": {CANCELED_TASK_JSON} }}"#));
    });
    let login_client = client(&server);
    let other = login_client.clone();
    assert_eq!(other.csrf_token(), None);

    login_client.login("hunter2hunter2").await.unwrap();
    assert_eq!(other.csrf_token(), Some("csrf-shared".to_string()));
    // A clone that never logged in sends the token the login produced.
    other.cancel_task("t1").await.unwrap();
    cancel.assert();
}

#[tokio::test]
async fn setup_and_relogin_replace_the_token_for_all_clones() {
    let server = MockServer::start();
    let mut setup = server.mock(|when, then| {
        when.method(httpmock::Method::POST).path("/api/auth/setup");
        then.status(201)
            .body(r#"{ "authenticated": true, "csrfToken": "csrf-setup" }"#);
    });
    let api = client(&server);
    let other = api.clone();
    api.setup("hunter2hunter2").await.unwrap();
    assert_eq!(other.csrf_token(), Some("csrf-setup".to_string()));
    setup.delete();

    server.mock(|when, then| {
        when.method(httpmock::Method::POST).path("/api/auth/login");
        then.status(200)
            .body(r#"{ "authenticated": true, "csrfToken": "csrf-relogin" }"#);
    });
    let stale = server.mock(|when, then| {
        when.method(httpmock::Method::POST)
            .path("/api/tasks/t1/cancel")
            .header("x-csrf-token", "csrf-setup");
        then.status(403).body(r#"{ "error": "stale token" }"#);
    });
    let fresh = server.mock(|when, then| {
        when.method(httpmock::Method::POST)
            .path("/api/tasks/t1/cancel")
            .header("x-csrf-token", "csrf-relogin");
        then.status(200)
            .body(format!(r#"{{ "task": {CANCELED_TASK_JSON} }}"#));
    });
    other.login("hunter2hunter2").await.unwrap();
    assert_eq!(api.csrf_token(), Some("csrf-relogin".to_string()));
    api.cancel_task("t1").await.unwrap();
    fresh.assert();
    stale.assert_hits(0);
}

#[tokio::test]
async fn logout_clears_the_token_for_every_clone() {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(httpmock::Method::POST)
            .path("/api/auth/logout")
            .header("x-csrf-token", "tok");
        then.status(204);
    });
    let api = client(&server);
    let other = api.clone();
    api.set_csrf_token(Some("tok".into()));
    other.logout().await.unwrap();
    assert_eq!(api.csrf_token(), None);
    assert_eq!(other.csrf_token(), None);
}

#[tokio::test]
async fn a_slow_logout_cannot_wipe_a_newer_login_token() {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(httpmock::Method::POST).path("/api/auth/logout");
        then.status(204).delay(Duration::from_millis(300));
    });
    server.mock(|when, then| {
        when.method(httpmock::Method::POST).path("/api/auth/login");
        then.status(200)
            .body(r#"{ "authenticated": true, "csrfToken": "csrf-new" }"#);
    });
    let api = client(&server);
    api.set_csrf_token(Some("csrf-old".into()));
    let logging_out = api.clone();
    let logout = tokio::spawn(async move { logging_out.logout().await });

    // While the logout is still in flight, the owner signs in again.
    tokio::time::sleep(Duration::from_millis(100)).await;
    api.login("hunter2hunter2").await.unwrap();
    logout.await.unwrap().unwrap();

    assert_eq!(api.csrf_token(), Some("csrf-new".to_string()));
}

#[tokio::test]
async fn concurrent_mutations_all_carry_the_current_token() {
    let server = MockServer::start();
    let cancel = server.mock(|when, then| {
        when.method(httpmock::Method::POST)
            .path("/api/tasks/t1/cancel")
            .header("x-csrf-token", "tok");
        then.status(200)
            .delay(Duration::from_millis(100))
            .body(format!(r#"{{ "task": {CANCELED_TASK_JSON} }}"#));
    });
    let api = client(&server);
    api.set_csrf_token(Some("tok".into()));
    let handles: Vec<_> = (0..8)
        .map(|_| {
            let api = api.clone();
            tokio::spawn(async move { api.cancel_task("t1").await })
        })
        .collect();
    for handle in handles {
        handle.await.unwrap().unwrap();
    }
    cancel.assert_hits(8);
}

// ---------------------------------------------------------------------------
// Concurrent refresh loaders
// ---------------------------------------------------------------------------

fn assistant_mocks<'a>(
    server: &'a MockServer,
    tasks_json: String,
    delay_ms: u64,
) -> Vec<httpmock::Mock<'a>> {
    vec![
        delayed_get(
            server,
            "/api/events",
            delay_ms,
            r#"{ "events": [] }"#.into(),
        ),
        delayed_get(
            server,
            "/api/approvals",
            delay_ms,
            r#"{ "approvals": [] }"#.into(),
        ),
        delayed_get(
            server,
            "/api/routines",
            delay_ms,
            r#"{ "routines": [] }"#.into(),
        ),
        delayed_get(
            server,
            "/api/projects",
            delay_ms,
            r#"{ "projects": [] }"#.into(),
        ),
        delayed_get(server, "/api/tasks", delay_ms, tasks_json),
    ]
}

#[tokio::test]
async fn assistant_loader_fetches_five_reads_concurrently_then_latest_detail() {
    let server = MockServer::start();
    let tasks_json = format!(r#"{{ "tasks": [{TASK_JSON}], {IDLE_EXECUTOR} }}"#);
    let mocks = assistant_mocks(&server, tasks_json, 300);
    let detail = delayed_get(&server, "/api/tasks/t1", 0, DETAIL_JSON.to_string());
    let api = client(&server);

    let started = Instant::now();
    let payload = load_assistant_data(&api).await;
    let elapsed = started.elapsed();

    // Five sequential 300 ms reads would take >= 1.5 s.
    assert!(elapsed < Duration::from_millis(1_000), "took {elapsed:?}");
    for mock in &mocks {
        mock.assert_hits(1);
    }
    detail.assert_hits(1);
    match payload {
        Payload::AssistantData {
            events,
            approvals,
            routines,
            projects,
            tasks,
            latest_task,
        } => {
            assert!(events.unwrap().is_empty());
            assert!(approvals.unwrap().is_empty());
            assert!(routines.unwrap().is_empty());
            assert!(projects.unwrap().is_empty());
            assert_eq!(tasks.unwrap().tasks.len(), 1);
            assert_eq!(latest_task.unwrap().task.id, "t1");
        }
        other => panic!("unexpected payload: {other:?}"),
    }
}

#[tokio::test]
async fn assistant_loader_skips_task_detail_when_there_are_no_tasks() {
    let server = MockServer::start();
    assistant_mocks(&server, format!(r#"{{ "tasks": [], {IDLE_EXECUTOR} }}"#), 0);
    let detail = delayed_get(&server, "/api/tasks/t1", 0, DETAIL_JSON.to_string());
    let api = client(&server);

    match load_assistant_data(&api).await {
        Payload::AssistantData {
            tasks, latest_task, ..
        } => {
            assert!(tasks.unwrap().tasks.is_empty());
            assert!(latest_task.is_none());
        }
        other => panic!("unexpected payload: {other:?}"),
    }
    detail.assert_hits(0);
}

#[tokio::test]
async fn assistant_loader_keeps_other_reads_when_the_task_list_fails() {
    let server = MockServer::start();
    let mut mocks = assistant_mocks(&server, String::new(), 0);
    // Replace the task list with a failure; the rest must still come back.
    mocks[4].delete();
    server.mock(|when, then| {
        when.method(httpmock::Method::GET).path("/api/tasks");
        then.status(500).body(r#"{ "error": "boom" }"#);
    });
    let detail = delayed_get(&server, "/api/tasks/t1", 0, DETAIL_JSON.to_string());
    let api = client(&server);

    match load_assistant_data(&api).await {
        Payload::AssistantData {
            events,
            projects,
            tasks,
            latest_task,
            ..
        } => {
            assert!(events.is_ok());
            assert!(projects.is_ok());
            assert!(tasks.unwrap_err().contains("boom"));
            assert!(latest_task.is_none());
        }
        other => panic!("unexpected payload: {other:?}"),
    }
    detail.assert_hits(0);
}

#[tokio::test]
async fn settings_loader_fetches_settings_and_destinations_concurrently() {
    let server = MockServer::start();
    let settings = delayed_get(&server, "/api/settings", 400, SETTINGS_JSON.to_string());
    let destinations = delayed_get(
        &server,
        "/api/exports/destinations",
        400,
        r#"{ "destinations": [] }"#.to_string(),
    );
    let api = client(&server);

    let started = Instant::now();
    let payload = load_settings_bundle(&api).await;
    let elapsed = started.elapsed();

    assert!(elapsed < Duration::from_millis(700), "took {elapsed:?}");
    settings.assert_hits(1);
    destinations.assert_hits(1);
    match payload {
        Payload::SettingsBundle {
            settings,
            destinations,
        } => {
            assert_eq!(settings.unwrap().provider, "openrouter");
            assert!(destinations.unwrap().is_empty());
        }
        other => panic!("unexpected payload: {other:?}"),
    }
}

#[tokio::test]
async fn tasks_loader_adds_detail_only_when_a_task_is_open() {
    let server = MockServer::start();
    delayed_get(
        &server,
        "/api/tasks",
        0,
        format!(r#"{{ "tasks": [{TASK_JSON}], {IDLE_EXECUTOR} }}"#),
    );
    let detail = delayed_get(&server, "/api/tasks/t1", 0, DETAIL_JSON.to_string());
    let api = client(&server);

    let list_only = load_tasks(&api, None).await;
    assert_eq!(list_only.len(), 1);
    assert!(matches!(list_only[0], Payload::Tasks(Ok(_))));
    detail.assert_hits(0);

    let with_detail = load_tasks(&api, Some("t1".into())).await;
    assert_eq!(with_detail.len(), 2);
    assert!(matches!(with_detail[1], Payload::TaskDetail(Ok(_))));
    detail.assert_hits(1);
}

// Finite mock bodies exercise EOF, not cancellation/deadlines of live streams.
mod live_sse {
    use super::*;
    use std::future::{poll_fn, Future};
    use std::sync::Arc;
    use std::task::Poll;

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};
    use tokio::sync::{mpsc, Notify};
    use tokio::task::JoinHandle;

    use crate::event::{subscribe_events, AppEvent, AppRx, SSE_MAX_STREAM_LIFETIME};

    // Keep the test runnable during loopback IO so paused time cannot auto-
    // advance past a deadline. A separate wall-clock bound prevents hangs.
    // Deadline assertions advance an extra 1 ms for Tokio's timer rounding.
    async fn io<T>(future: impl Future<Output = T>) -> T {
        tokio::pin!(future);
        let started = Instant::now();
        poll_fn(|cx| {
            assert!(started.elapsed() < Duration::from_secs(5), "IO stalled");
            match future.as_mut().poll(cx) {
                Poll::Ready(value) => Poll::Ready(value),
                Poll::Pending => {
                    cx.waker().wake_by_ref();
                    Poll::Pending
                }
            }
        })
        .await
    }

    struct Subscription {
        listener: TcpListener,
        api: ApiClient,
        rx: AppRx,
        wake: Arc<Notify>,
        handle: JoinHandle<()>,
    }

    impl Drop for Subscription {
        fn drop(&mut self) {
            self.handle.abort();
        }
    }

    impl Subscription {
        async fn new() -> Self {
            let listener = io(TcpListener::bind("127.0.0.1:0")).await.unwrap();
            let base_url = format!("http://{}", listener.local_addr().unwrap());
            let api = ApiClient::new(&base_url).unwrap();
            api.cookie_jar().add_cookie_str(
                "openfrost_session=test-session; Path=/",
                &url::Url::parse(&base_url).unwrap(),
            );
            api.set_csrf_token(Some("test-csrf".into()));
            let (tx, rx) = mpsc::unbounded_channel();
            let wake = Arc::new(Notify::new());
            let handle = tokio::spawn(subscribe_events(
                base_url,
                api.stream_http(),
                tx,
                wake.clone(),
            ));
            Self {
                listener,
                api,
                rx,
                wake,
                handle,
            }
        }

        async fn request(&self, path: &str) -> (TcpStream, String) {
            let (mut stream, _) = io(self.listener.accept()).await.unwrap();
            let mut headers = Vec::new();
            while !headers.ends_with(b"\r\n\r\n") {
                let mut byte = [0];
                assert_eq!(io(stream.read(&mut byte)).await.unwrap(), 1);
                headers.push(byte[0]);
                assert!(headers.len() < 16_384);
            }
            let headers = String::from_utf8(headers).unwrap().to_ascii_lowercase();
            assert!(headers.starts_with(path), "{headers}");
            (stream, headers)
        }

        async fn open(&mut self) -> TcpStream {
            let (mut stream, headers) = self.request("get /api/events/stream ").await;
            assert!(headers.contains("openfrost_session=test-session"));
            // Close-delimited HTTP/1.1 body, intentionally left open.
            io(stream.write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n: heartbeat\n\n",
            )).await.unwrap();
            self.connected(true).await;
            stream
        }

        async fn connected(&mut self, expected: bool) {
            assert!(matches!(
                io(self.rx.recv()).await,
                Some(AppEvent::SseConnection(value)) if value == expected
            ));
        }

        async fn activity(&mut self, stream: &mut TcpStream) {
            io(stream.write_all(b": heartbeat\n\nevent: activity\ndata: {}\n\n"))
                .await
                .unwrap();
            assert!(matches!(io(self.rx.recv()).await, Some(AppEvent::Activity)));
        }
    }

    async fn closed(stream: &mut TcpStream) {
        let mut byte = [0];
        assert_eq!(io(stream.read(&mut byte)).await.unwrap(), 0);
    }

    async fn refuse(stream: &mut TcpStream) {
        io(stream.write_all(
            b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        ))
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn healthy_stream_rotates_at_fixed_deadline_despite_heartbeats_and_activity() {
        tokio::time::pause();
        let mut subscription = Subscription::new().await;
        let mut stream = subscription.open().await;
        // Traffic survives the former 30 s total timeout and keeps the 45 s
        // read timeout alive, but must never renew the auth deadline.
        for _ in 0..(SSE_MAX_STREAM_LIFETIME.as_secs() / 15 - 1) {
            tokio::time::advance(Duration::from_secs(15)).await;
            subscription.activity(&mut stream).await;
            assert!(subscription.rx.try_recv().is_err());
        }
        tokio::time::advance(Duration::from_secs(14)).await;
        subscription.activity(&mut stream).await;
        assert!(subscription.rx.try_recv().is_err());
        tokio::time::advance(Duration::from_millis(1_001)).await;
        subscription.connected(false).await;
        closed(&mut stream).await;
        // A scheduled rotation makes a fresh authenticated GET without backoff.
        let mut replacement = subscription.open().await;
        subscription.activity(&mut replacement).await;
        assert!(subscription.rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn revoked_session_is_rejected_at_rotation_then_backs_off_and_wakes_on_login() {
        tokio::time::pause();
        let mut subscription = Subscription::new().await;
        let mut stream = subscription.open().await;
        // Model initial-only auth: revocation does not stop the old stream.
        for _ in 0..(SSE_MAX_STREAM_LIFETIME.as_secs() / 15 - 1) {
            tokio::time::advance(Duration::from_secs(15)).await;
            subscription.activity(&mut stream).await;
        }
        tokio::time::advance(Duration::from_millis(15_001)).await;
        subscription.connected(false).await;
        closed(&mut stream).await;
        let (mut rejected, _) = subscription.request("get /api/events/stream ").await;
        refuse(&mut rejected).await;
        subscription.connected(false).await;
        assert!(subscription.rx.try_recv().is_err());
        // A failed rotation uses the existing 1 s, then 2 s backoff.
        tokio::time::advance(Duration::from_millis(999)).await;
        assert!(futures::poll!(Box::pin(subscription.listener.accept())).is_pending());
        tokio::time::advance(Duration::from_millis(2)).await;
        let (mut rejected, _) = subscription.request("get /api/events/stream ").await;
        refuse(&mut rejected).await;
        subscription.connected(false).await;
        let before_wake = tokio::time::Instant::now();
        subscription.wake.notify_one();
        let _replacement = subscription.open().await;
        assert_eq!(before_wake.elapsed(), Duration::ZERO);
    }

    #[tokio::test]
    async fn silent_established_stream_times_out_after_45_seconds() {
        tokio::time::pause();
        let mut subscription = Subscription::new().await;
        let mut stream = subscription.open().await;
        tokio::time::advance(Duration::from_secs(44)).await;
        assert!(subscription.rx.try_recv().is_err());
        tokio::time::advance(Duration::from_millis(1_001)).await;
        subscription.connected(false).await;
        closed(&mut stream).await;
        tokio::time::advance(Duration::from_millis(1_001)).await;
        let _replacement = subscription.open().await;
    }

    #[tokio::test]
    async fn stream_client_times_out_silent_response_headers_after_45_seconds() {
        tokio::time::pause();
        let listener = io(TcpListener::bind("127.0.0.1:0")).await.unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let api = ApiClient::new(&base_url).unwrap();
        let request = api
            .stream_http()
            .get(format!("{base_url}/api/events/stream"));
        let pending = tokio::spawn(request.send());
        let (_silent, _) = io(listener.accept()).await.unwrap();
        tokio::time::advance(Duration::from_secs(44)).await;
        assert!(!pending.is_finished());
        tokio::time::advance(Duration::from_millis(1_001)).await;
        let error = io(pending).await.unwrap().unwrap_err();
        assert!(error.is_timeout(), "{error:?}");
    }

    #[tokio::test]
    async fn logout_wake_closes_established_stream_and_reauthenticates_without_cookie() {
        tokio::time::pause();
        let mut subscription = Subscription::new().await;
        let mut stream = subscription.open().await;
        subscription.activity(&mut stream).await;
        let api = subscription.api.clone();
        let logout = tokio::spawn(async move { api.logout().await });
        let (mut logout_stream, headers) = subscription.request("post /api/auth/logout ").await;
        assert!(headers.contains("x-csrf-token: test-csrf"));
        assert!(headers.contains("openfrost_session=test-session"));
        io(logout_stream.write_all(
            b"HTTP/1.1 204 No Content\r\nSet-Cookie: openfrost_session=; Max-Age=0; Path=/\r\nConnection: close\r\n\r\n",
        )).await.unwrap();
        io(logout).await.unwrap().unwrap();
        assert_eq!(subscription.api.csrf_token(), None);
        // The app supplies this wake after applying the logout result.
        let before_wake = tokio::time::Instant::now();
        subscription.wake.notify_one();
        subscription.connected(false).await;
        closed(&mut stream).await;
        let (mut rejected, headers) = subscription.request("get /api/events/stream ").await;
        assert!(!headers.contains("openfrost_session=test-session"));
        refuse(&mut rejected).await;
        subscription.connected(false).await;
        assert_eq!(before_wake.elapsed(), Duration::ZERO);
        assert!(subscription.rx.try_recv().is_err());
    }
}
