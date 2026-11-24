fn portal_screencast(window: bool, restore_key: Option<&str>, stopping: &AtomicBool, startup: Option<Startup>) -> Result<(Stream, Option<String>)> {
    use ashpd::desktop::PersistMode;
    use ashpd::desktop::screencast::{CursorMode, Screencast, SourceType};

    let (ready_tx, ready_rx) = flume::bounded::<Result<(u32, OwnedFd, Option<[f64; 4]>, Option<String>, Option<String>, bool)>>(1);
    let (stop_tx, stop_rx) = flume::bounded::<()>(1);
    let request_key = restore_key.map(str::to_owned);
    std::thread::Builder::new()
        .name("apparent-portal-screencast".into())
        .spawn(move || {
            futures_lite::future::block_on(async move {
                let run = async {
                    StartupPoint::PortalConnect.record_in(startup.as_ref());
                    let proxy = Screencast::new().await?;
                    StartupPoint::PortalCreate.record_in(startup.as_ref());
                    let session = proxy.create_session().await?;
                    let request = async {
                        let token = request_key.as_deref().and_then(saved_token);
                        let kind = if window {
                            SourceType::Window
                        } else {
                            SourceType::Monitor
                        };
                        StartupPoint::PortalSelect.record_in(startup.as_ref());
                        proxy
                            .select_sources(
                                &session,
                                CursorMode::Embedded,
                                kind.into(),
                                false,
                                token.as_deref(),
                                if !window && request_key.is_some() {
                                    PersistMode::ExplicitlyRevoked
                                } else {
                                    PersistMode::DoNot
                                },
                            )
                            .await?;
                        StartupPoint::PortalStart.record_in(startup.as_ref());
                        let streams = proxy.start(&session, None).await?.response()?;
                        StartupPoint::PortalResponse.record_in(startup.as_ref());
                        let token = streams.restore_token().map(str::to_owned);
                        let stream = streams.streams().first().context("Nothing was shared")?;
                        validate_source_type(window, stream.source_type())?;
                        let portal_monitor = stream.source_type() == Some(SourceType::Monitor);
                        if portal_monitor {
                            apparent_log(format!("Screen sharing monitor metadata: position={:?}, size={:?}", stream.position(), stream.size()));
                        }
                        let rect = match (stream.position(), stream.size()) {
                            (Some((x, y)), Some((w, h))) => {
                                Some([f64::from(x), f64::from(y), f64::from(w), f64::from(h)])
                            }
                            _ => None,
                        };
                        let node = stream.pipe_wire_node_id();
                        let mapping_id = stream.mapping_id().map(str::to_owned);
                        StartupPoint::PipewireRequest.record_in(startup.as_ref());
                        let fd = proxy.open_pipe_wire_remote(&session).await?;
                        StartupPoint::PipewireOpen.record_in(startup.as_ref());
                        anyhow::Ok((node, fd, rect, mapping_id, token, portal_monitor))
                    };
                    let cancelled = async {
                        let _ = stop_rx.recv_async().await;
                        bail!("Screen sharing was cancelled")
                    };
                    match futures_lite::future::race(request, cancelled).await {
                        Ok((node, fd, rect, mapping_id, token, portal_monitor)) => anyhow::Ok((proxy, session, node, fd, rect, mapping_id, token, portal_monitor)),
                        Err(error) => {
                            let _ = session.close().await;
                            Err(error)
                        }
                    }
                };
                match run.await {
                    Ok((_proxy, session, node, fd, rect, mapping_id, token, portal_monitor)) => {
                        let _ = ready_tx.send(Ok((node, fd, rect, mapping_id, token, portal_monitor)));
                        let _ = stop_rx.recv_async().await;
                        let _ = session.close().await;
                    }
                    Err(error) => {
                        let _ = ready_tx.send(Err(error));
                    }
                }
            });
        })?;
    let deadline = std::time::Instant::now() + Duration::from_secs(120);
    let (node, fd, rect, mapping_id, token, portal_monitor) = loop {
        if stopping.load(Ordering::Acquire) || std::time::Instant::now() >= deadline {
            let _ = stop_tx.try_send(());
            bail!("Screen sharing was cancelled or the dialog wasn't answered");
        }
        match ready_rx.recv_timeout(Duration::from_millis(100)) {
            Ok(Ok(stream)) => break stream,
            Ok(Err(error)) => {
                if let Some(key) = restore_key {
                    save_token(key, None);
                }
                return Err(error);
            }
            Err(flume::RecvTimeoutError::Timeout) => {}
            Err(error) => return Err(error.into()),
        }
    };
    Ok((Stream {
        node,
        fd: Some(fd),
        rect,
        mapping_id,
        portal_monitor,
        stop: Some(stop_tx),
    }, token))
}
