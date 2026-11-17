pub struct HudPillWindow {
    coordinator: Entity<ApparentCoordinator>,
    focus: FocusHandle,
    /// The capsule's native shell, scale and blur where the platform draws them.
    chrome: PillChrome,
    /// Frames drawn so far, counting to 2.
    frames: u8,
    #[cfg(target_os = "linux")]
    equalizer: InputEqualizer,
}

#[cfg(target_os = "linux")]
#[derive(Default)]
struct InputEqualizer {
    last_count: usize,
    level: f32,
}

#[cfg(target_os = "linux")]
impl InputEqualizer {
    fn step(&mut self, input: Option<(usize, f32)>, reduced_motion: bool) {
        if input.is_none_or(|(count, _)| count < self.last_count) {
            self.last_count = 0;
        }
        let target = match input {
            Some((count, level)) if count > self.last_count => level,
            _ => 0.0,
        };
        self.last_count = input.map_or(0, |(count, _)| count);
        let alpha = if reduced_motion {
            1.0
        } else if target > self.level {
            0.24
        } else {
            0.12
        };
        self.level += (target - self.level) * alpha;
    }
}

impl Render for HudPillWindow {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let tracing = motion::tracing();
        let frame = self.frames;
        if tracing && frame == 0 {
            motion::trace_skip_frame();
        } else if tracing {
            motion::trace_frame();
        }
        self.frames = self.frames.saturating_add(1).min(2);
        if frame == 0 {
            // A new window shows a few frames after it's asked for; its opening fade and blur
            // start from the frame that is seen, not from the request.
            self.coordinator.update(cx, |coord, _| {
                if coord.island_opacity < 0.98
                    && !matches!(coord.island_phase, IslandPhase::Dismissing)
                {
                    coord.island_opacity = 0.0;
                    coord.island_phase_since = motion::now();
                    coord.island_stepped = Instant::now();
                    coord.island_await_frame = true;
                }
            });
        }
        self.coordinator.update(cx, |coord, cx| {
            if frame == 1 {
                coord.island_await_frame = false;
            }
            if coord.is_island_visible() {
                coord.step_island(cx);
            }
        });
        let coord = self.coordinator.read(cx);
        let phase = coord.island_phase;
        let prev_phase = coord.island_prev_phase;
        let target_phase = match phase {
            IslandPhase::Dismissing => coord.island_dismissed_from,
            other => other,
        };
        let phase_age = motion::age(coord.island_phase_since);
        let width = coord.island_width;
        let scale = coord.island_scale;
        let y_off = coord.island_y;
        let opacity = coord.island_opacity.clamp(0.0, 1.0);
        let recording_ms = coord
            .active_recording
            .as_ref()
            .map(ActiveRecording::elapsed_ms);
        let mic_warning = if matches!(phase, IslandPhase::Recording) {
            coord
                .active_recording
                .as_ref()
                .and_then(ActiveRecording::mic_warning)
        } else {
            None
        };
        #[cfg(target_os = "linux")]
        let equalizer_enabled = recording_equalizer_enabled();
        #[cfg(target_os = "linux")]
        if matches!(phase, IslandPhase::Recording) && equalizer_enabled {
            let input =
                coord
                    .active_recording
                    .as_ref()
                    .and_then(|recording| match &recording.source {
                        CaptureSource::Screen {
                            audio: Some(audio), ..
                        } => audio.input_activity(),
                        _ => None,
                    });
            self.equalizer.step(input, coord.reduced_motion);
        }
        let elapsed_ms = recording_ms.unwrap_or(coord.last_elapsed_ms);
        let switch = coord
            .switch
            .filter(|_| matches!(phase, IslandPhase::Selecting { .. }));
        let island_velocity = coord.island_velocity;
        let highlight_prev = coord.highlight_prev;
        let highlight_p = ease_out_cubic(motion::age(coord.highlight_since) / HIGHLIGHT_FADE_S);
        let clock = format_clock(elapsed_ms);
        let has_iphone = coord.iphone.is_some();
        let completed_note = coord.completed_note.clone();
        let completed_issue = coord.completed_audio_issue();
        let completed_warning = completed_issue.is_some();
        let live_no_words = coord.recording_has_no_words() && !coord.reveal.is_open();
        let pill_theme = PillTheme::for_window(window);
        let recording_warning = mic_warning.is_some() || live_no_words;
        let warning_focus = recording_warning || completed_warning;
        // The Recording capsule's trailing group: switch chips or controls, and the swap between.
        let chips = if matches!(phase, IslandPhase::Recording) {
            coord.reveal.is_open()
        } else {
            coord.reveal_prev_chips
        };
        let reduced = coord.reduced_motion;
        let tune = motion::tune();
        let swap_age = motion::age(coord.reveal_since);
        let (enter_s, exit_s) = if reduced {
            (REDUCED_FADE_S, REDUCED_FADE_S * 0.8)
        } else {
            (tune.reveal_enter_s, tune.reveal_exit_s)
        };
        let swap = matches!(phase, IslandPhase::Recording)
            .then_some(coord.reveal_outgoing)
            .flatten()
            .filter(|_| swap_age < enter_s.max(exit_s));
        let target_width = island_content_width(
            window,
            target_phase,
            &clock,
            has_iphone,
            chips,
            mic_warning,
            completed_note.as_deref(),
            completed_issue,
            live_no_words,
        );
        let snap_initial_width =
            phase_age < 0.025 && matches!(phase, IslandPhase::Selecting { .. }) && opacity < 0.35;
        let switch_layout = switch.map(|morph| {
            let clock_w = measure_text(
                window,
                &clock_template(&clock),
                HUD_TEXT,
                FontWeight::SEMIBOLD,
            );
            SwitchLayout::new(morph, width, target_width, clock_w)
        });
        self.coordinator.update(cx, |coord, _| {
            coord.island_target_width = target_width;
            if snap_initial_width {
                coord.island_width = target_width;
            }
            if recording_ms.is_some() {
                coord.last_elapsed_ms = elapsed_ms;
            }
            if let (Some(morph), Some(layout)) = (coord.switch.as_mut(), switch_layout)
                && morph.slide.is_none()
            {
                // The chips were pinned to the left edge, so they moved at half the width's
                // speed: the row starts there, at that speed.
                morph.slide = Some((layout.dx, -0.5 * island_velocity));
            }
        });
        let render_width = if snap_initial_width {
            target_width
        } else {
            width
        };

        // Two-beat `.blurReplace` cross-transition inside the springing shell:
        // - When morphing between two visible states (`has_prev`):
        //   * 0..55ms (exit): outgoing `prev_phase` stays mounted while blurring `0 -> 3.5px` and fading `1 -> 0.15`.
        //   * 55..140ms (enter): incoming `target_phase` mounts and unblurs `3.5 -> 0px` while fading `0.15 -> 1`.
        // - When opening/dismissing: subtle `3.5px -> 0px` blur over 110ms.
        // A switch chip's morph keeps its items, so nothing is replaced (`SwitchMorph`).
        let has_prev = !matches!(prev_phase, IslandPhase::Hidden | IslandPhase::Dismissing)
            && !matches!(phase, IslandPhase::Hidden | IslandPhase::Dismissing)
            && switch_layout.is_none();
        // Reduce motion keeps the cross-fade and drops the blur.
        let swap_blur = if reduced { 0.0 } else { 3.5 };
        let (content_phase, blur_radius, content_alpha) =
            if matches!(phase, IslandPhase::Dismissing) {
                (
                    target_phase,
                    ((1.0 - opacity) * 3.5).clamp(0.0, 3.5),
                    opacity,
                )
            } else if switch_layout.is_some() {
                (target_phase, 0.0, 1.0)
            } else if has_prev && phase_age < 0.055 {
                let t_out = (phase_age / 0.055).clamp(0.0, 1.0);
                (prev_phase, swap_blur * t_out, 1.0 - 0.85 * t_out)
            } else if has_prev && phase_age < 0.145 {
                let t_in = ease_out_cubic(((phase_age - 0.055) / 0.090).clamp(0.0, 1.0));
                (target_phase, swap_blur * (1.0 - t_in), 0.15 + 0.85 * t_in)
            } else if swap.is_some() && !reduced {
                // Chips ↔ controls in place: a sine blur pulse, sharp at both ends.
                let t = (swap_age / enter_s).clamp(0.0, 1.0);
                (
                    target_phase,
                    tune.reveal_blur_px * (std::f32::consts::PI * t).sin(),
                    1.0,
                )
            } else if !has_prev && matches!(target_phase, IslandPhase::Recording) {
                // Opening straight into Recording: the shell springs out from a compact capsule
                // with the lead pinned to its left edge, and each trailing item fades in as the
                // edge uncovers it (`edge_alpha`), so nothing waits for the shell.
                (target_phase, 0.0, 1.0)
            } else if !has_prev && opacity < 0.999 {
                // Opening: the content sharpens as the capsule fades in (both step-driven).
                (target_phase, swap_blur * (1.0 - opacity), 1.0)
            } else {
                (target_phase, 0.0, 1.0)
            };
        // The swap's blur leaves the content's scale alone so the pinned lead stays put.
        let content_shrink = if swap.is_some() { 0.0 } else { 0.015 };
        let is_completed = matches!(target_phase, IslandPhase::Completed { .. });

        self.chrome.apply(
            render_width,
            ISLAND_H,
            scale,
            y_off,
            opacity,
            is_completed,
            blur_radius,
            content_shrink,
        );
        let trace_xf = tracing
            .then(|| {
                self.chrome.trace(
                    render_width,
                    scale,
                    y_off,
                    opacity,
                    content_alpha,
                    blur_radius,
                    content_shrink,
                )
            })
            .flatten();

        let c_paste_down = self.coordinator.clone();
        let c_paste_up = self.coordinator.clone();
        let c_paste_out = self.coordinator.clone();
        let c_inspect = self.coordinator.clone();
        let c_dismiss = self.coordinator.clone();
        let c_record = self.coordinator.clone();
        let c_sel_cancel = self.coordinator.clone();

        // Keep typography (`HUD_TEXT`) and spacing (`CHIP_GAP`) 100% constant so glyphs never
        // re-hint or jump; all scaling happens in the GPU CALayer transform.
        let row = div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(CHIP_GAP))
            .text_size(px(HUD_TEXT))
            .whitespace_nowrap()
            .opacity(content_alpha);
        // Traces a row's children under these names (`APPARENT_MOTION_TRACE`).
        let traced = |group: Div, keys: Vec<Option<(String, f32)>>| match trace_xf {
            Some(xf) => group.on_children_prepainted(motion::trace_children(keys, xf, "row")),
            None => group,
        };
        let named = |names: &[&str]| -> Vec<Option<(String, f32)>> {
            names.iter().map(|n| Some(((*n).to_owned(), 1.0))).collect()
        };

        // The highlight cross-fades from the mode it left.
        let highlight = |m: SelectionMode, mode: SelectionMode| -> f32 {
            match highlight_prev.filter(|prev| *prev != mode) {
                _ if m == mode && highlight_prev.is_none() => 1.0,
                Some(_) if m == mode => highlight_p,
                Some(prev) if m == prev => 1.0 - highlight_p,
                _ => f32::from(u8::from(m == mode)),
            }
        };
        // Per-item opacity of the picker row while it slides in (`SwitchMorph`).
        let selecting_alphas = |mode: SelectionMode| -> Vec<f32> {
            let Some(layout) = switch_layout else {
                return Vec::new();
            };
            let modes = SelectionMode::available(has_iphone);
            let mut widths: Vec<f32> = modes.iter().map(|&m| segment_width(window, m)).collect();
            if mode.shows_record() {
                widths.push(chip_width(window, "Record", FontWeight::SEMIBOLD));
            }
            widths.extend([layout.divider_w, CHIP_H]);
            trail_offsets(layout.row_left(), &widths)
                .iter()
                .zip(&widths)
                .map(|(&x, &w)| uncover_alpha(layout.inner_now + ISLAND_INSET, x, w))
                .collect()
        };
        let ghost = switch_layout.map(|layout| {
            let pieces = layout.ghost_alphas();
            div()
                .absolute()
                .top(px(ISLAND_INSET))
                .left(px(ISLAND_INSET + layout.ghost_left()))
                .h(px(CHIP_H))
                .flex()
                .items_center()
                .gap(px(CHIP_GAP))
                .text_size(px(HUD_TEXT))
                .whitespace_nowrap()
                .child(
                    div()
                        .flex()
                        .flex_none()
                        .items_center()
                        .pr(px(LEAD_TRAIL))
                        .child(
                            div()
                                .size(px(CHIP_H))
                                .flex_none()
                                .flex()
                                .items_center()
                                .justify_center()
                                .opacity(pieces[0])
                                .child(div().size(px(8.0)).rounded_full().bg(rgb(INK_RED))),
                        )
                        .child(
                            div()
                                .w(px(layout.clock_w))
                                .font(tabular_font(FontWeight::SEMIBOLD))
                                .opacity(pieces[1])
                                .child(clock.clone()),
                        ),
                )
                .child(island_divider(pill_theme).opacity(pieces[2]))
        });
        let ghost = match (ghost, trace_xf) {
            (Some(g), Some(xf)) => {
                let lead_alpha = switch_layout.map_or(0.0, |l| l.ghost_alphas()[1]);
                let divider_alpha = switch_layout.map_or(0.0, |l| l.ghost_alphas()[2]);
                Some(g.on_children_prepainted(motion::trace_children(
                    vec![
                        Some(("lead".into(), lead_alpha)),
                        Some(("divider.lead".into(), divider_alpha)),
                    ],
                    xf,
                    "row",
                )))
            }
            (ghost, _) => ghost,
        };

        let capsule_content = match content_phase {
            IslandPhase::Selecting { mode } => {
                let alphas = selecting_alphas(mode);
                let alpha = |i: usize| alphas.get(i).copied().unwrap_or(1.0);
                let n_modes = SelectionMode::available(has_iphone).len();
                let record = mode.shows_record();
                let after = n_modes + usize::from(record);
                traced(
                    row.when_some(switch_layout, |row, layout| {
                        row.relative().left(px(layout.dx))
                    }),
                    SelectionMode::available(has_iphone)
                        .iter()
                        .map(|m| m.label())
                        .map(|label| format!("chip:{label}"))
                        .chain(record.then(|| "record".to_owned()))
                        .chain(["divider.close".to_owned(), "close".to_owned()])
                        .enumerate()
                        .map(|(i, key)| Some((key, alpha(i))))
                        .collect(),
                )
                .children(SelectionMode::available(has_iphone).iter().enumerate().map(
                    |(i, &segment)| {
                        let c_segment = self.coordinator.clone();
                        mode_segment_level(segment, highlight(segment, mode), pill_theme, !record)
                            .opacity(alpha(i))
                            .on_click(move |_, _, cx| {
                                c_segment.update(cx, |coord, cx| {
                                    coord.click_selection_mode(segment, cx)
                                });
                            })
                    },
                ))
                .when(record, |row| {
                    row.child(
                        primary_chip("sel-record", "Record", pill_theme, false)
                            .opacity(alpha(n_modes))
                            .on_click(move |_, _, cx| {
                                c_record.update(cx, |coord, cx| coord.record_selected_mode(cx));
                            }),
                    )
                })
                .child(island_divider(pill_theme).opacity(alpha(after)))
                .child(
                    icon_circle_chip("sel-cancel", "✕", pill_theme)
                        .opacity(alpha(after + 1))
                        .on_click(move |_, _, cx| {
                            c_sel_cancel.update(cx, |coord, cx| coord.cancel_recording(cx));
                        }),
                )
            }
            IslandPhase::Completed { inbox_count, .. } => traced(
                row,
                ["done.lead", "divider.lead", "paste"]
                    .into_iter()
                    .map(str::to_owned)
                    .chain(["inspect".to_owned(), "close".to_owned()])
                    .map(|name| Some((name, 1.0)))
                    .collect(),
            )
            .child(
                island_lead()
                    .child(
                        div()
                            .size(px(CHIP_H))
                            .rounded_full()
                            .flex_none()
                            .flex()
                            .items_center()
                            .justify_center()
                            .bg(rgb(if completed_warning {
                                WARNING
                            } else {
                                pill_theme.neutral()
                            }))
                            .text_color(rgb(if completed_warning {
                                pill_theme::CARBON
                            } else {
                                pill_theme.text()
                            }))
                            .text_size(px(13.0))
                            .font_weight(FontWeight::BOLD)
                            .child(if completed_warning { "!" } else { "✓" }),
                    )
                    .child(
                        div()
                            .ml(px(8.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(rgb(pill_theme.text()))
                            .child(completed_status_label(
                                inbox_count,
                                completed_note.as_deref(),
                                completed_issue,
                            )),
                    ),
            )
            .child(island_divider(pill_theme))
            .child(
                primary_chip("hud-paste", "Paste", pill_theme, completed_warning)
                    .on_mouse_down(MouseButton::Left, move |_, _, cx| {
                        let start = current_mouse_screen();
                        c_paste_down.update(cx, |coord, _| {
                            coord.paste_drag_start = start;
                        });
                    })
                    .on_mouse_up(MouseButton::Left, move |_, _, cx| {
                        c_paste_up.update(cx, |coord, cx| {
                            coord.paste_drag_start = None;
                            coord.paste_completed_bundle(None, cx);
                        });
                    })
                    .on_mouse_up_out(MouseButton::Left, move |_, _, cx| {
                        let end = current_mouse_screen();
                        c_paste_out.update(cx, |coord, cx| {
                            if let (Some(start), Some(drop_pt)) =
                                (coord.paste_drag_start.take(), end)
                            {
                                let dist = (drop_pt[0] - start[0]).hypot(drop_pt[1] - start[1]);
                                if dist >= 24.0 {
                                    coord.paste_completed_bundle(Some(drop_pt), cx);
                                }
                            }
                        });
                    }),
            )
            .when(crate::shared::handoff::experiment(crate::connect::hosted::HOSTED_SHARING), |row| {
                let enabled = self.coordinator.read(cx).share_online && self.coordinator.read(cx).share_pending.is_none();
                let coordinator = self.coordinator.clone();
                row.child(pill_chip("hud-copy-link", "Public link", pill_theme)
                    .opacity(if enabled { 1.0 } else { 0.4 })
                    .on_click(move |_, _, cx| {
                        if enabled { coordinator.update(cx, |coord, cx| coord.copy_completed_link(cx)); }
                    }))
            })
            .child(
                pill_chip("hud-inspect", "Inspect", pill_theme).on_click(move |_, _, cx| {
                    c_inspect.update(cx, |coord, cx| coord.inspect_completed_bundle(cx));
                }),
            )
            .child(
                icon_circle_chip("hud-dismiss", "✕", pill_theme).on_click(move |_, _, cx| {
                    c_dismiss.update(cx, |coord, cx| coord.dismiss_completed_bundle(cx));
                }),
            ),
            IslandPhase::Recording => {
                // A soft ripple leaves the dot every 1.6s while the dot itself breathes.
                #[cfg(target_os = "linux")]
                let meter_w = if equalizer_enabled {
                    EQUALIZER_W + CHIP_GAP
                } else {
                    0.0
                };
                #[cfg(not(target_os = "linux"))]
                let meter_w = 0.0;
                #[cfg(target_os = "linux")]
                let meter = equalizer_enabled.then(|| {
                    div()
                        .w(px(EQUALIZER_W))
                        .h(px(18.0))
                        .flex_none()
                        .flex()
                        .items_center()
                        .justify_center()
                        .gap(px(2.0))
                        .children([0.6, 0.9, 1.0, 0.8, 0.5].map(|weight| {
                            div()
                                .w(px(3.0))
                                .h(px(3.0 + 15.0 * self.equalizer.level * weight))
                                .rounded(px(1.5))
                                .bg(rgb(0xff6b67))
                        }))
                });
                #[cfg(not(target_os = "linux"))]
                let meter: Option<Div> = None;
                let cycle = 1.6;
                let ripple = (phase_age / cycle).fract();
                let breath = 0.5 + 0.5 * (std::f32::consts::TAU * phase_age / cycle).cos();
                let halo = 8.0 + 12.0 * ease_out_cubic(ripple);
                let clock_w = measure_text(
                    window,
                    &clock_template(&clock),
                    HUD_TEXT,
                    FontWeight::SEMIBOLD,
                );
                let lead = island_lead_base();
                #[cfg(any(target_os = "linux", target_os = "macos"))]
                let lead = lead.on_mouse_down(MouseButton::Left, |_, _, _| {
                    platform::begin_pill_drag();
                });
                traced(
                    row,
                    vec![
                        Some(("lead".into(), 1.0)),
                        Some(("divider.lead".into(), 1.0)),
                        None,
                    ],
                )
                .child(
                    lead
                        .child(
                            div()
                                .size(px(CHIP_H))
                                .flex_none()
                                .flex()
                                .items_center()
                                .justify_center()
                                .child(
                                    div()
                                        .size(px(halo))
                                        .rounded_full()
                                        .flex()
                                        .items_center()
                                        .justify_center()
                                        .bg(with_alpha(INK_RED, 0.34 * (1.0 - ripple).powi(2)))
                                        .child(
                                            div()
                                                .size(px(8.0))
                                                .rounded_full()
                                                .bg(with_alpha(INK_RED, 0.72 + 0.28 * breath)),
                                        ),
                                ),
                        )
                        .child(
                            div()
                                .w(px(clock_w))
                                .font(tabular_font(FontWeight::SEMIBOLD))
                                .child(clock),
                        ),
                )
                .child(island_divider(pill_theme))
                .when_some(meter, |row, meter| row.child(meter))
                .when_some(mic_warning, |row, warning| {
                    row.child(
                        div()
                            .flex_none()
                            .px(px(CHIP_PX))
                            .text_size(px(HUD_TEXT))
                            .text_color(rgb(pill_theme.warning_text()))
                            .bg(rgb(if pill_theme.dark { 0x4a360e } else { 0xf5d98a }))
                            .rounded(px(4.0))
                            .child(warning.label()),
                    )
                    .child(island_divider(pill_theme))
                })
                .child({
                    // The trailing slot: switch chips or controls. The lead is pinned to the
                    // shell's left edge (`justify_start` below), so each item's fade follows how
                    // far the springing right edge has uncovered it.
                    let trail_x0 = CHIP_H
                        + clock_w
                        + LEAD_TRAIL
                        + CHIP_GAP
                        + (1.0 + 2.0 * DIVIDER_MX)
                        + CHIP_GAP
                        + mic_warning.map_or(0.0, |warning| {
                            measure_text(window, warning.label(), HUD_TEXT, FontWeight::MEDIUM)
                                + 2.0 * CHIP_PX
                                + (1.0 + 2.0 * DIVIDER_MX)
                                + 2.0 * CHIP_GAP
                        })
                        + meter_w;
                    let inner_now = render_width - 2.0 * ISLAND_INSET;
                    let alphas = |group_chips: bool, fade: f32| -> (Vec<f32>, f32) {
                        let widths = recording_trail_widths(window, group_chips, has_iphone);
                        let alphas = trail_offsets(trail_x0, &widths)
                            .iter()
                            .zip(&widths)
                            .map(|(&x, &w)| fade * edge_alpha(inner_now, x, w))
                            .collect();
                        let total = widths.iter().sum::<f32>()
                            + widths.len().saturating_sub(1) as f32 * CHIP_GAP;
                        (alphas, total)
                    };
                    let enter = swap.map_or(1.0, |_| ease_out_cubic(swap_age / enter_s));
                    let (in_alphas, in_w) = alphas(chips, enter);
                    let outgoing = swap.and_then(|out_chips| {
                        let fade = 1.0 - ease_out_cubic(swap_age / exit_s);
                        (fade > 0.002).then(|| {
                            let (out_alphas, _) = alphas(out_chips, fade);
                            traced(
                                self.recording_trail(
                                    out_chips,
                                    has_iphone,
                                    &out_alphas,
                                    false,
                                    pill_theme,
                                    recording_warning,
                                ),
                                trail_keys(out_chips, has_iphone, &out_alphas, "out:"),
                            )
                        })
                    });
                    div()
                        .relative()
                        .flex()
                        .flex_none()
                        .items_center()
                        .h(px(CHIP_H))
                        .w(px(in_w))
                        .when_some(outgoing, |slot, group| {
                            slot.child(div().absolute().left(px(0.0)).top(px(0.0)).child(group))
                        })
                        .child(traced(
                            self.recording_trail(
                                chips,
                                has_iphone,
                                &in_alphas,
                                true,
                                pill_theme,
                                recording_warning,
                            ),
                            trail_keys(chips, has_iphone, &in_alphas, ""),
                        ))
                })
                .when(live_no_words, |row| {
                    row.child(island_divider(pill_theme)).child(
                        div()
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(rgb(pill_theme.warning_text()))
                            .pr(px(LIVE_WARNING_END_PAD))
                            .child("⚠ No words yet"),
                    )
                })
            }
            IslandPhase::Processing => {
                // 120Hz 8-dot orbiting progress ring inside the leading 32px slot.
                let dots = (0..8).map(|i| {
                    let frac = i as f32 / 8.0;
                    let angle = frac * std::f32::consts::TAU - std::f32::consts::FRAC_PI_2;
                    let turn = (phase_age * 2.1 - frac).rem_euclid(1.0);
                    let intensity = (1.0 - turn).powi(2);
                    let dot_r = 1.35 + 0.65 * intensity;
                    let cx_dot = 16.0 + 7.2 * angle.cos() - dot_r;
                    let cy_dot = 16.0 + 7.2 * angle.sin() - dot_r;
                    div()
                        .absolute()
                        .left(px(cx_dot))
                        .top(px(cy_dot))
                        .size(px(dot_r * 2.0))
                        .rounded_full()
                        .bg(with_alpha(pill_theme.text(), 0.20 + 0.80 * intensity))
                });
                traced(row, named(&["processing"])).child(
                    div()
                        .flex()
                        .flex_none()
                        .items_center()
                        .pr(px(CHIP_PX))
                        .whitespace_nowrap()
                        .child(div().size(px(CHIP_H)).flex_none().relative().children(dots))
                        .child(
                            div()
                                .ml(px(6.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(rgb(pill_theme.text()))
                                .child("Processing…"),
                        ),
                )
            }
            IslandPhase::Hidden | IslandPhase::Dismissing => row,
        };

        let has_shell = self.chrome.has_shell();
        let c_keys = self.coordinator.clone();
        let pin_lead = matches!(content_phase, IslandPhase::Recording);
        // Without a native shell the capsule itself springs: its size follows the shell's scale
        // and it rides the shell's y offset, with the shell's shadow.
        let (shell_w, shell_h, shell_y) = if has_shell {
            (render_width, ISLAND_H, 0.0)
        } else {
            let s = scale.clamp(0.5, 1.15);
            (render_width * s, ISLAND_H * s, y_off)
        };

        div()
            .track_focus(&self.focus)
            // Clicking a chip can make the pill the key window; keep the picker's keyboard map.
            .on_key_down(move |event: &KeyDownEvent, _, cx| {
                if c_keys.update(cx, |coord, cx| {
                    coord.handle_selection_key(&event.keystroke, event.is_held, cx)
                }) {
                    cx.stop_propagation();
                }
            })
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .opacity(opacity)
            .child(
                div()
                    .relative()
                    .top(px(shell_y))
                    .w(px(shell_w))
                    .h(px(shell_h))
                    .flex_none()
                    .p(px(if has_shell { ISLAND_INSET } else { ISLAND_PAD }))
                    .rounded(px(if has_shell {
                        ISLAND_RADIUS
                    } else {
                        shell_h / 2.0
                    }))
                    .when(!has_shell, |d| {
                        d.shadow(vec![BoxShadow {
                            color: gpui::hsla(0.0, 0.0, 0.0, 0.40 * opacity),
                            offset: point(px(0.0), px(5.0)),
                            blur_radius: px(14.0),
                            spread_radius: px(0.0),
                        }])
                    })
                    .overflow_hidden()
                    .flex()
                    .items_center()
                    .when(pin_lead, |d| d.justify_start())
                    .when(!pin_lead, |d| d.justify_center())
                    .when(!has_shell, |d| {
                        d.bg(rgb(pill_theme.surface()))
                            .border_1()
                            .border_color(with_alpha(
                                pill_theme.line(),
                                if warning_focus { 0.40 } else { 0.24 },
                            ))
                    })
                    .text_color(rgb(pill_theme.text()))
                    .text_size(px(HUD_TEXT))
                    .whitespace_nowrap()
                    .relative()
                    .when_some(ghost, |d, ghost| d.child(ghost))
                    .child(capsule_content),
            )
    }
}

/// Where a switch chip's morph is this frame (`SwitchMorph`), in points from the capsule's
/// inner left edge.
#[derive(Clone, Copy, Debug)]
struct SwitchLayout {
    /// The picker row's offset from its resting place.
    dx: f32,
    clock_w: f32,
    lead_w: f32,
    divider_w: f32,
    /// The capsule's inner width now, and the picker row's width.
    inner_now: f32,
    inner_row: f32,
}

impl SwitchLayout {
    fn new(morph: SwitchMorph, width: f32, target_width: f32, clock_w: f32) -> Self {
        let lead_w = CHIP_H + clock_w + LEAD_TRAIL;
        let divider_w = 1.0 + 2.0 * DIVIDER_MX;
        let inner_row = target_width - 2.0 * ISLAND_INSET;
        let dx = morph.slide.map_or_else(
            || {
                // From the capsule's centre: where the chips were, pinned behind the lead, and
                // where the centred picker row rests.
                let chips = -width / 2.0 + ISLAND_INSET + lead_w + divider_w + 2.0 * CHIP_GAP;
                chips + inner_row / 2.0
            },
            |(x, _)| x,
        );
        Self {
            dx,
            clock_w,
            lead_w,
            divider_w,
            inner_now: width - 2.0 * ISLAND_INSET,
            inner_row,
        }
    }

    fn row_left(&self) -> f32 {
        (self.inner_now - self.inner_row) / 2.0 + self.dx
    }

    /// The leaving lead and divider sit just in front of the row, as they did in the pill.
    fn ghost_left(&self) -> f32 {
        self.row_left() - 2.0 * CHIP_GAP - self.divider_w - self.lead_w
    }

    /// Dot, clock and divider each fade out as they near the capsule's left edge and are gone
    /// when they reach it, so nothing is cut by a hard edge while it still shows.
    fn ghost_alphas(&self) -> [f32; 3] {
        // Each piece's left edge in the pill, from the shell's outer edge.
        let rests = [
            ISLAND_INSET + CHIP_H / 2.0 - 4.0,
            ISLAND_INSET + CHIP_H,
            ISLAND_INSET + self.lead_w + CHIP_GAP + DIVIDER_MX,
        ];
        rests.map(|rest| {
            let left = self.ghost_left() + rest;
            let t = (left / rest.min(40.0)).clamp(0.0, 1.0);
            t * t * (3.0 - 2.0 * t)
        })
    }
}

impl HudPillWindow {
    /// One trailing group of the Recording capsule, each item faded by `alphas`: the switch chips
    /// (Screen selected, as a tap records the screen) or Cancel · Finish. An outgoing
    /// group isn't `interactive`.
    fn recording_trail(
        &self,
        chips: bool,
        has_iphone: bool,
        alphas: &[f32],
        interactive: bool,
        theme: PillTheme,
        warning: bool,
    ) -> Div {
        let alpha = |i: usize| alphas.get(i).copied().unwrap_or(1.0);
        let group = div().flex().flex_none().items_center().gap(px(CHIP_GAP));
        if chips {
            return group.children(SelectionMode::available(has_iphone).iter().enumerate().map(
                |(i, &mode)| {
                    let c_switch = self.coordinator.clone();
                    mode_segment(mode, mode == SelectionMode::Screen, theme, true)
                        .opacity(alpha(i))
                        .when(interactive, |d| {
                            d.on_click(move |_, _, cx| {
                                c_switch.update(cx, |coord, cx| coord.switch_recording(mode, cx));
                            })
                        })
                },
            ));
        }
        let c_cancel = self.coordinator.clone();
        let c_finish = self.coordinator.clone();
        let group = group.child(
            pill_chip("hud-cancel", "Cancel", theme)
                .opacity(alpha(0))
                .when(interactive, |d| {
                    d.on_click(move |_, _, cx| {
                        c_cancel.update(cx, |coord, cx| coord.cancel_recording(cx));
                    })
                }),
        );
        let group = group.when(whiteboard_enabled(), |group| {
            let c_board = self.coordinator.clone();
            group.child(
                pill_chip("hud-whiteboard", "Whiteboard", theme)
                    .opacity(alpha(1))
                    .when(interactive, |d| {
                        d.on_click(move |_, _, cx| {
                            let coord = c_board.clone();
                            cx.defer(move |cx| whiteboard::open(&coord, cx));
                        })
                    }),
            )
        });
        group.child(
            primary_chip("hud-done", "Finish", theme, warning)
                .opacity(alpha(if whiteboard_enabled() { 2 } else { 1 }))
                .when(interactive, |d| {
                    d.on_click(move |_, _, cx| {
                        c_finish.update(cx, |coord, cx| coord.finish_recording(cx));
                    })
                }),
        )
    }
}

/// Leading status cluster: a 32px slot concentric with the capsule's left cap, then text.
/// Also acts as the drag handle for the floating island.
fn island_lead() -> Div {
    island_lead_base().map(platform::window_drag_region)
}

fn island_lead_base() -> Div {
    div()
        .flex()
        .flex_none()
        .items_center()
        .pr(px(LEAD_TRAIL))
        .whitespace_nowrap()
}

fn island_divider(theme: PillTheme) -> Div {
    div()
        .w(px(1.0))
        .h(px(16.0))
        .mx(px(DIVIDER_MX))
        .flex_none()
        .bg(with_alpha(theme.text(), 0.24))
}

fn hud_chip(id: impl Into<gpui::ElementId>) -> gpui::Stateful<Div> {
    div()
        .id(id)
        .h(px(CHIP_H))
        .px(px(CHIP_PX))
        .rounded(px(CHIP_RADIUS))
        .flex()
        .flex_none()
        .items_center()
        .justify_center()
        .whitespace_nowrap()
}

fn pill_chip(
    id: impl Into<gpui::ElementId>,
    label: impl Into<gpui::SharedString>,
    theme: PillTheme,
) -> gpui::Stateful<Div> {
    hud_chip(id)
        .font_weight(FontWeight::MEDIUM)
        .text_color(rgb(theme.soft()))
        .cursor_pointer()
        .hover(move |s| s.bg(rgb(theme.hover())).text_color(rgb(theme.text())))
        .child(label.into())
}

fn primary_chip(
    id: &'static str,
    label: &'static str,
    theme: PillTheme,
    warning: bool,
) -> gpui::Stateful<Div> {
    hud_chip(id)
        .bg(rgb(if warning { theme.surface() } else { SIGNAL }))
        .when(warning, |d| d.border_1().border_color(rgb(theme.text())))
        .text_color(rgb(if warning {
            theme.text()
        } else {
            theme.active_text()
        }))
        .font_weight(FontWeight::SEMIBOLD)
        .cursor_pointer()
        .hover(move |s| s.bg(rgb(if warning { theme.hover() } else { SIGNAL_HOVER })))
        .child(label)
}

fn icon_circle_chip(id: &'static str, icon: &'static str, theme: PillTheme) -> gpui::Stateful<Div> {
    div()
        .id(id)
        .size(px(CHIP_H))
        .rounded_full()
        .flex()
        .flex_none()
        .items_center()
        .justify_center()
        .text_size(px(12.0))
        .text_color(rgb(theme.muted()))
        .cursor_pointer()
        .hover(move |s| s.bg(rgb(theme.hover())).text_color(rgb(theme.text())))
        .child(icon)
}

/// One segment of the selection-mode control: line icon + label. Weight stays constant across
/// states so switching never shifts the measured capsule width (`selecting_row_width`).
fn mode_segment(
    mode: SelectionMode,
    active: bool,
    theme: PillTheme,
    accent: bool,
) -> gpui::Stateful<Div> {
    mode_segment_level(mode, f32::from(u8::from(active)), theme, accent)
}

fn mix_rgb(from: u32, to: u32, t: f32) -> gpui::Rgba {
    let t = t.clamp(0.0, 1.0);
    let channel = |shift: u32| {
        let a = ((from >> shift) & 0xff) as f32;
        let b = ((to >> shift) & 0xff) as f32;
        ((a + (b - a) * t).round() as u32) << shift
    };
    rgb(channel(16) | channel(8) | channel(0))
}

/// A mode chip `level` of the way to selected, so the highlight can cross-fade between chips.
fn mode_segment_level(
    mode: SelectionMode,
    level: f32,
    theme: PillTheme,
    accent: bool,
) -> gpui::Stateful<Div> {
    let group = mode.chip_id();
    let level = level.clamp(0.0, 1.0);
    let active = level > 0.5;
    hud_chip(group)
        .group(group)
        .px(px(SEG_PX))
        .gap(px(SEG_ICON_GAP))
        .font_weight(FontWeight::MEDIUM)
        .bg(with_alpha(
            if accent { SIGNAL } else { theme.neutral() },
            level,
        ))
        .text_color(mix_rgb(
            theme.soft(),
            if accent {
                theme.active_text()
            } else {
                theme.text()
            },
            level,
        ))
        .cursor_pointer()
        .hover(move |s| {
            s.bg(rgb(if active && accent {
                SIGNAL_HOVER
            } else {
                theme.hover()
            }))
            .text_color(rgb(if active && accent {
                theme.active_text()
            } else {
                theme.text()
            }))
        })
        // `svg()` tints with its own text colour, so hover is mirrored through the group.
        .child(
            svg()
                .path(mode.icon())
                .size(px(SEG_ICON))
                .flex_none()
                .text_color(mix_rgb(
                    theme.muted(),
                    if accent {
                        theme.active_text()
                    } else {
                        theme.text()
                    },
                    level,
                ))
                .group_hover(group, move |s| {
                    s.text_color(rgb(if active && accent {
                        theme.active_text()
                    } else {
                        theme.text()
                    }))
                }),
        )
        .child(mode.label())
}

/// CleanShot-style floating camera cursor rendered at `(x, y)` in `SelectionMode::Window`.
fn camera_cursor_badge(x: f32, y: f32) -> Div {
    div()
        .absolute()
        .left(px(x - 20.0))
        .top(px(y - 20.0))
        .size(px(40.0))
        .rounded_full()
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .bg(rgba(0x161619eb))
        .border_1()
        .border_color(rgba(0xffffff38))
        .shadow(vec![BoxShadow {
            color: gpui::hsla(0.0, 0.0, 0.0, 0.45),
            offset: point(px(0.0), px(3.0)),
            blur_radius: px(10.0),
            spread_radius: px(0.0),
        }])
        .child(
            // Top viewfinder hump
            div()
                .w(px(9.0))
                .h(px(2.5))
                .rounded_t(px(1.5))
                .bg(rgb(0xf5f5f7)),
        )
        .child(
            // Camera body + lens
            div()
                .w(px(21.0))
                .h(px(14.5))
                .rounded(px(3.5))
                .bg(rgb(0xf5f5f7))
                .flex()
                .items_center()
                .justify_center()
                .child(
                    div()
                        .size(px(9.0))
                        .rounded_full()
                        .bg(rgb(0x161619))
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(div().size(px(4.5)).rounded_full().bg(rgb(0xf5f5f7))),
                ),
        )
}

pub struct TargetPickerWindow {
    coordinator: Entity<ApparentCoordinator>,
    focus: FocusHandle,
}

impl Render for TargetPickerWindow {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let coord = self.coordinator.read(cx);
        let mode = match coord.island_phase {
            IslandPhase::Selecting { mode } => mode,
            _ => SelectionMode::Area,
        };
        let drag = coord.selection_drag;
        let hovered = coord.hovered_window.clone();
        let anim_rect = coord.animated_window_rect;
        let pointer = coord.selection_pointer;

        let c_down = self.coordinator.clone();
        let c_move = self.coordinator.clone();
        let c_up = self.coordinator.clone();
        let c_key = self.coordinator.clone();

        let win_bounds = window.bounds();
        // The picker covers one display; pointer, windows and areas are global points.
        let origin = [coord.display_rect[0], coord.display_rect[1]];
        // Global coordinates are points on macOS and pixels on Windows; this window lays out in points.
        let k = platform::points_per_pixel(window);
        let screen = [
            f32::from(win_bounds.size.width),
            f32::from(win_bounds.size.height),
        ];

        let iphone_rect = coord.iphone_preview.as_ref().and_then(PhoneSession::rect);
        let iphone_name = coord
            .iphone_preview
            .as_ref()
            .and_then(PhoneSession::device)
            .or_else(|| coord.iphone.clone())
            .map_or_else(|| "iPhone".to_string(), |d| d.name);

        // Selection rect in window-local coordinates, clipped to the screen, plus its badge.
        let highlight: Option<([f32; 4], String)> = match mode {
            SelectionMode::Area => drag.map(|(a, b)| {
                let [a, b] = [a, b].map(|p| clamp_point(p, coord.display_rect));
                let w = (a[0] - b[0]).abs().max(1.0);
                let h = (a[1] - b[1]).abs().max(1.0);
                (
                    [
                        (a[0].min(b[0]) - origin[0]) * k,
                        (a[1].min(b[1]) - origin[1]) * k,
                        w * k,
                        h * k,
                    ],
                    format!("{} × {}", w.round() as i32, h.round() as i32),
                )
            }),
            SelectionMode::Window => hovered.map(|t| {
                let title = match (&t.app, &t.window_title) {
                    (Some(app), Some(win)) if !win.is_empty() && win != app => {
                        format!("{app} — {win}")
                    }
                    (Some(app), _) => app.clone(),
                    _ => format!(
                        "{} × {}",
                        t.frame.width.round() as i32,
                        t.frame.height.round() as i32
                    ),
                };
                let [rx, ry, rw, rh] = anim_rect.unwrap_or([
                    t.frame.x as f32,
                    t.frame.y as f32,
                    t.frame.width as f32,
                    t.frame.height as f32,
                ]);
                (
                    [(rx - origin[0]) * k, (ry - origin[1]) * k, rw * k, rh * k],
                    title,
                )
            }),
            SelectionMode::Screen => Some((
                [0.0, 0.0, screen[0], screen[1]],
                "Full screen · Click to record".to_string(),
            )),
            SelectionMode::Iphone => iphone_rect.map(|[rx, ry, rw, rh]| {
                (
                    [(rx - origin[0]) * k, (ry - origin[1]) * k, rw * k, rh * k],
                    format!("{iphone_name} · Click to record"),
                )
            }),
        }
        .map(|(rect, label)| (clip_rect(rect, screen), label));

        let badge = highlight.as_ref().map(|(rect, label)| {
            let max_text = (screen[0] - 2.0 * BADGE_MARGIN - 2.0 * BADGE_PX - 2.0).min(480.0);
            let measured_label = if mode == SelectionMode::Area {
                clock_template(label)
            } else {
                label.clone()
            };
            let text_w =
                measure_text(window, &measured_label, BADGE_TEXT, FontWeight::MEDIUM).min(max_text);
            let size = [text_w + 2.0 * BADGE_PX + 2.0, BADGE_H];
            let anchor = match mode {
                SelectionMode::Area | SelectionMode::Iphone => BadgeAnchor::BelowTrailing,
                SelectionMode::Window | SelectionMode::Screen => BadgeAnchor::Center,
            };
            (
                place_badge(*rect, size, screen, anchor),
                text_w,
                label.clone(),
            )
        });

        // The 120Hz `LaserOverlay` draws the backdrop dim, selection cutout, window tint,
        // and inset border continuously across both `Selecting` and `Recording` so there is zero
        // window swap or border jump on recording start. `TargetPickerWindow` only provides the
        // hit-test surface, cursor style, camera cursor follower, and tabular dimension badge.
        let mut root = div()
            .id("apparent-target-picker")
            .track_focus(&self.focus)
            .size_full()
            .relative()
            .when(mode == SelectionMode::Area, |d| d.cursor_crosshair())
            .when(
                matches!(mode, SelectionMode::Iphone | SelectionMode::Screen),
                |d| d.cursor_pointer(),
            )
            .when(mode == SelectionMode::Window, |d| {
                d.cursor(gpui::CursorStyle::None)
            });

        if mode == SelectionMode::Window
            && let Some([px_screen, py_screen]) = pointer
        {
            let cx_local = (px_screen - origin[0]) * k;
            let cy_local = (py_screen - origin[1]) * k;
            root = root.child(camera_cursor_badge(cx_local, cy_local));
        }

        root.when_some(badge, |d, ([bx, by], text_w, label)| {
            d.child(
                div()
                    .absolute()
                    .left(px(bx))
                    .top(px(by))
                    .h(px(BADGE_H))
                    .px(px(BADGE_PX))
                    .rounded(px(BADGE_H / 2.0))
                    .flex()
                    .items_center()
                    .bg(rgba(0x1c1c1ef2))
                    .border_1()
                    .border_color(rgba(0xffffff21))
                    .shadow(vec![BoxShadow {
                        color: gpui::hsla(0.0, 0.0, 0.0, 0.3),
                        offset: point(px(0.0), px(2.0)),
                        blur_radius: px(8.0),
                        spread_radius: px(0.0),
                    }])
                    .text_size(px(BADGE_TEXT))
                    .font(tabular_font(FontWeight::MEDIUM))
                    .text_color(rgb(TEXT_COLOR))
                    .child(div().w(px(text_w)).truncate().child(label)),
            )
        })
        .on_key_down(move |event: &KeyDownEvent, _, cx| {
            // Unhandled, gpui hands the key back to AppKit, which offers it again (as a key
            // equivalent, keyDown, or input method command) and this runs up to three times:
            // Space and the arrows then toggle or cycle back to where they started.
            if c_key.update(cx, |coord, cx| {
                coord.handle_selection_key(&event.keystroke, event.is_held, cx)
            }) {
                cx.stop_propagation();
            }
        })
        .on_mouse_down(
            MouseButton::Left,
            move |event: &MouseDownEvent, _window, cx| {
                let [sx, sy] = current_mouse_screen()
                    .unwrap_or([f32::from(event.position.x), f32::from(event.position.y)]);
                c_down.update(cx, |coord, cx| {
                    let cur_mode = match coord.island_phase {
                        IslandPhase::Selecting { mode } => mode,
                        _ => return,
                    };
                    match cur_mode {
                        SelectionMode::Area => {
                            coord.selection_drag = Some(([sx, sy], [sx, sy]));
                            coord.sync_picker_overlay();
                            cx.notify();
                        }
                        SelectionMode::Iphone => {
                            if let Some([rx, ry, rw, rh]) =
                                coord.iphone_preview.as_ref().and_then(PhoneSession::rect)
                                && sx >= rx
                                && sx <= rx + rw
                                && sy >= ry
                                && sy <= ry + rh
                            {
                                coord.start_recording_iphone(cx);
                            } else {
                                coord.set_selection_mode(SelectionMode::Area, cx);
                                coord.selection_drag = Some(([sx, sy], [sx, sy]));
                                coord.sync_picker_overlay();
                                cx.notify();
                            }
                        }
                        SelectionMode::Window => {
                            if coord.windows_loading {
                                return;
                            }
                            if let Some(target) = selectable_window_at(
                                &coord.selectable_windows,
                                f64::from(sx),
                                f64::from(sy),
                            )
                            .cloned()
                            {
                                coord.start_recording_with_target(target, cx);
                            } else {
                                coord.start_recording_full_screen(cx);
                            }
                        }
                        SelectionMode::Screen => coord.start_recording_full_screen(cx),
                    }
                });
            },
        )
        .on_mouse_move(move |event: &MouseMoveEvent, _window, cx| {
            let [sx, sy] = current_mouse_screen()
                .unwrap_or([f32::from(event.position.x), f32::from(event.position.y)]);
            c_move.update(cx, |coord, cx| {
                coord.selection_pointer = Some([sx, sy]);
                let cur_mode = match coord.island_phase {
                    IslandPhase::Selecting { mode } => mode,
                    _ => return,
                };
                match cur_mode {
                    SelectionMode::Area => {
                        if let Some((start, _)) = coord.selection_drag {
                            coord.selection_drag = Some((start, [sx, sy]));
                            coord.sync_picker_overlay();
                            cx.notify();
                        }
                    }
                    SelectionMode::Iphone => {
                        coord.sync_picker_overlay();
                    }
                    SelectionMode::Screen => {}
                    SelectionMode::Window => {
                        let found = coord
                            .selectable_windows
                            .iter()
                            .find(|w| {
                                let f = w.frame;
                                f64::from(sx) >= f.x
                                    && f64::from(sx) <= f.x + f.width
                                    && f64::from(sy) >= f.y
                                    && f64::from(sy) <= f.y + f.height
                            })
                            .cloned();
                        if coord.hovered_window.as_ref().and_then(|w| w.window_id)
                            != found.as_ref().and_then(|w| w.window_id)
                        {
                            coord.hovered_window = found;
                            coord.sync_picker_overlay();
                            cx.notify();
                        }
                    }
                }
            });
        })
        .on_mouse_up(MouseButton::Left, {
            let c_up = c_up.clone();
            move |event: &MouseUpEvent, _window, cx| {
                c_up.update(cx, |coord, cx| coord.picker_mouse_up(event, cx));
            }
        })
        // A drag released past the picker's display (on another one) ends there too, at the
        // display's edge: the window that saw the press gets the release, outside its bounds.
        .on_mouse_up_out(
            MouseButton::Left,
            move |event: &MouseUpEvent, _window, cx| {
                c_up.update(cx, |coord, cx| coord.picker_mouse_up(event, cx));
            },
        )
    }
}
