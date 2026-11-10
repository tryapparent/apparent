//! Own pending SelectSources and Start Requests as well as the ScreenCast
//! Session. ashpd exposes their handles only after the chooser responds.
use std::collections::HashMap;
use std::io::Read;
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use ashpd::desktop::{
    PersistMode, Response,
    screencast::{CursorMode, SourceType, Streams},
};
use futures_lite::StreamExt;
use zbus::{
    Proxy,
    zvariant::{OwnedObjectPath, OwnedValue, Type, Value},
};

pub(super) struct PendingRequest {
    request: Proxy<'static>,
    token: String,
}

impl PendingRequest {
    pub(super) async fn new(portal: &Proxy<'_>) -> Result<Self> {
        let mut random = [0; 16];
        std::fs::File::open("/dev/urandom")?.read_exact(&mut random)?;
        let token = format!(
            "apparent_{}",
            random
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        );
        let sender = portal
            .connection()
            .unique_name()
            .context("Portal connection has no unique name")?
            .trim_start_matches(':')
            .replace('.', "_");
        let path = format!("/org/freedesktop/portal/desktop/request/{sender}/{token}");
        let request = Proxy::new_owned(
            portal.connection().clone(),
            portal.destination().to_string(),
            path,
            "org.freedesktop.portal.Request",
        )
        .await?;
        Ok(Self { request, token })
    }

    pub(super) async fn start(
        &self,
        portal: &Proxy<'_>,
        session: &(impl serde::Serialize + Type),
    ) -> Result<Streams> {
        let options = HashMap::from([("handle_token", Value::from(self.token.as_str()))]);
        self.response(portal, "Start", &(session, "", options))
            .await
    }

    pub(super) async fn select_sources(
        &self,
        portal: &Proxy<'_>,
        session: &(impl serde::Serialize + Type),
        kind: SourceType,
        restore_token: Option<&str>,
        persist_mode: PersistMode,
    ) -> Result<()> {
        // Keep the existing ashpd SelectSources fields and values. Some portals
        // open their chooser here rather than in Start.
        let mut options = HashMap::from([
            ("handle_token", Value::from(self.token.as_str())),
            ("types", Value::from(kind as u32)),
            ("multiple", Value::from(false)),
            ("cursor_mode", Value::from(CursorMode::Embedded as u32)),
            ("persist_mode", Value::from(persist_mode as u32)),
        ]);
        if let Some(token) = restore_token {
            options.insert("restore_token", Value::from(token));
        }
        let _: HashMap<String, OwnedValue> = self
            .response(portal, "SelectSources", &(session, options))
            .await?;
        Ok(())
    }

    async fn response<T: serde::de::DeserializeOwned + Type>(
        &self,
        portal: &Proxy<'_>,
        method: &str,
        body: &(impl serde::Serialize + Type),
    ) -> Result<T> {
        // Subscribe before the call: a fast response must not race our listener.
        let mut responses = self.request.receive_signal("Response").await?;
        let returned: OwnedObjectPath = portal.call(method, body).await?;
        if returned.as_str() != self.request.path().as_str() {
            // Do not strand a request from an older/nonconforming provider.
            let other = Proxy::new_owned(
                portal.connection().clone(),
                portal.destination().to_string(),
                returned,
                "org.freedesktop.portal.Request",
            )
            .await?;
            let _ = close_request(&other, Duration::from_secs(2)).await;
            bail!("Screen sharing portal returned an unexpected Request handle");
        }
        let response = responses
            .next()
            .await
            .context("Screen sharing portal did not respond")?;
        match response.body().deserialize::<Response<T>>()? {
            Response::Ok(value) => Ok(value),
            Response::Err(error) => Err(error.into()),
        }
    }

    pub(super) async fn until_stopped<T>(
        &self,
        operation: impl std::future::Future<Output = Result<T>>,
        stop: &flume::Receiver<()>,
    ) -> Result<T> {
        let cancelled = async {
            let _ = stop.recv_async().await;
            Err(anyhow!("Screen sharing was cancelled"))
        };
        let result = futures_lite::future::race(operation, cancelled).await;
        if result.is_err() {
            // Session.Close releases streams, but Request.Close ends its pending
            // chooser. Drop the pending operation before closing either resource.
            if let Err(error) = close_request(&self.request, Duration::from_secs(2)).await {
                crate::capture::engine::runtime::apparent_log(format!(
                    "Screen sharing Request cleanup failed: {error:#}"
                ));
            }
        }
        result
    }
}

// ashpd's shared connection has no method timeout. Bound this new cleanup wait
// without changing that connection's capture/permission calls or adding a runtime.
async fn close_request(request: &Proxy<'_>, timeout: Duration) -> Result<()> {
    let (expired_tx, expired_rx) = flume::bounded(1);
    let (finished_tx, finished_rx) = flume::bounded::<()>(1);
    let timer = std::thread::Builder::new()
        .name("apparent-portal-close".into())
        .spawn(move || {
            if matches!(
                finished_rx.recv_timeout(timeout),
                Err(flume::RecvTimeoutError::Timeout)
            ) {
                let _ = expired_tx.send(());
            }
        })?;
    let result = futures_lite::future::race(
        async {
            request
                .call::<_, _, ()>("Close", &())
                .await
                .map_err(anyhow::Error::from)
        },
        async {
            let _ = expired_rx.recv_async().await;
            Err(anyhow!("Screen sharing Request.Close timed out"))
        },
    )
    .await;
    drop(finished_tx);
    let _ = timer.join();
    result
}

#[cfg(test)]
mod tests;
