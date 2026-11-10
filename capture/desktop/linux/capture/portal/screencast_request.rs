//! Own the pending Start Request as well as the ScreenCast Session. ashpd's
//! Start future does not expose its Request until after the chooser responds.
use std::collections::HashMap;
use std::io::Read;
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use ashpd::desktop::{Response, screencast::Streams};
use futures_lite::StreamExt;
use zbus::{
    Proxy,
    zvariant::{OwnedObjectPath, Type, Value},
};

pub(super) struct StartRequest {
    request: Proxy<'static>,
    token: String,
}

impl StartRequest {
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
        // Subscribe before Start: a fast response must not race our listener.
        let mut responses = self.request.receive_signal("Response").await?;
        let options = HashMap::from([("handle_token", Value::from(self.token.as_str()))]);
        let returned: OwnedObjectPath = portal.call("Start", &(session, "", options)).await?;
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
        match response.body().deserialize::<Response<Streams>>()? {
            Response::Ok(streams) => Ok(streams),
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
