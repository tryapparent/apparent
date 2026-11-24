use super::{
    LiveOverlayEvent, Ordering, PoisonError, SCALE, SharedCaptureTelemetry, Stroke, is_real_ink,
};

pub(super) fn track_shift_ink(
    telemetry: &SharedCaptureTelemetry,
    (x, y): (f64, f64),
    pure_shift: bool,
    prev_shift_ink: bool,
) {
    if pure_shift
        && !telemetry.notes_editing.load(Ordering::Acquire)
        && telemetry.contains_screen_point(x, y)
    {
        telemetry.shift_held.store(true, Ordering::Release);
        let t_ms = telemetry.elapsed_ms();
        let (nx, ny, fw, fh) = telemetry.normalize_point(x, y);
        let [sx, sy] = [nx, ny].map(|v| (v * SCALE as f32).round() as i32);
        let mut guard = telemetry
            .live_ink
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let stroke = guard.get_or_insert_with(|| {
            telemetry.window_log_request.store(true, Ordering::Release);
            telemetry.observe_pointer_context(crate::shared::model::ActionKind::Stroke, t_ms, x, y);
            #[cfg(any(target_os = "linux", target_os = "macos"))]
            if let Some(session) = telemetry
                .circle_session
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .as_ref()
            {
                session.begin_mark(t_ms);
            }
            if telemetry.probing() {
                crate::capture::engine::accessibility::mark_started(t_ms, x, y);
            }
            Stroke {
                color: Some(crate::shared::handoff::pen::rgb()),
                t0: t_ms,
                t1: t_ms,
                fw,
                fh,
                on: None,
                pin: None,
                laser: false,
                pts: Vec::new(),
            }
        });
        let dt = t_ms.saturating_sub(stroke.t0) as i32;
        let should_push = stroke.pts.chunks_exact(3).last().is_none_or(|prev| {
            let dx = (sx - prev[0]) as f32 / SCALE as f32 * fw as f32;
            let dy = (sy - prev[1]) as f32 / SCALE as f32 * fh as f32;
            dx.hypot(dy) >= 1.5
        });
        if should_push && stroke.pts.len() / 3 < 2_400 {
            stroke.pts.extend_from_slice(&[sx, sy, dt]);
            stroke.t1 = t_ms;
        }
    } else if !pure_shift && prev_shift_ink {
        telemetry.shift_held.store(false, Ordering::Release);
        if let Some(stroke) = telemetry
            .live_ink
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take()
            && is_real_ink(&stroke)
        {
            telemetry.observe_stroke_end_context(&stroke);
            if telemetry.probing() {
                let frame = *telemetry
                    .target_frame
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner);
                crate::capture::engine::accessibility::probe_stroke(&stroke, frame);
            }
            #[cfg(any(target_os = "linux", target_os = "macos"))]
            if let Some(session) = telemetry
                .circle_session
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .as_ref()
            {
                session.end_mark(&stroke);
            }
            telemetry
                .strokes
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .push(stroke);
            let _ = telemetry
                .ui_sender
                .try_send(LiveOverlayEvent::RequestSnapshot);
        }
    }
}
