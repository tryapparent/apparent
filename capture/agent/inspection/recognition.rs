//! Mark recognition and compatibility exports for semantic output and drawing geometry.

use crate::semantics::describe_mark;
use crate::model::*;
use std::f32::consts::PI;

pub fn bounds(points: &[[f32; 2]]) -> [f32; 4] {
    let Some(&[x, y]) = points.first() else {
        return [0.0; 4];
    };
    points.iter().fold([x, y, x, y], |b, p| {
        [
            b[0].min(p[0]),
            b[1].min(p[1]),
            b[2].max(p[0]),
            b[3].max(p[1]),
        ]
    })
}

pub fn distance(a: [f32; 2], b: [f32; 2]) -> f32 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}

pub fn shape_of(stroke: &Stroke) -> Shape {
    ink_of(stroke).shape
}

/// One stroke's shape and what a mark needs from it, in normalized coordinates.
struct Ink {
    shape: Shape,
    /// What the stroke covers: a circle's loop without its lead-in or tail, else the whole stroke.
    region: [f32; 4],
    /// A one-stroke arrow's shaft start and tip.
    ends: Option<([f32; 2], [f32; 2])>,
}

fn ink_of(stroke: &Stroke) -> Ink {
    let norm = stroke.normalized_points();
    let region = bounds(&norm);
    let plain = |shape| Ink {
        shape,
        region,
        ends: None,
    };
    if stroke.pin.is_some() {
        return plain(Shape::Pin);
    }
    let points: Vec<_> = norm
        .iter()
        .map(|p| [p[0] * stroke.fw as f32, p[1] * stroke.fh as f32])
        .collect();
    let Some(&first) = points.first() else {
        return plain(Shape::Tap);
    };
    let b = bounds(&points);
    let (w, h) = (b[2] - b[0], b[3] - b[1]);
    let len: f32 = points.windows(2).map(|p| distance(p[0], p[1])).sum();
    let last = *points.last().unwrap();
    let chord = distance(first, last);
    let shoelace = points
        .windows(2)
        .map(|p| p[0][0] * p[1][1] - p[1][0] * p[0][1])
        .sum::<f32>()
        + last[0] * first[1]
        - first[0] * last[1];
    let loop_box = || loop_in(&points).map(|(i, j)| bounds(&norm[i..=j]));
    if w.hypot(h) < 14.0 {
        plain(Shape::Tap)
    } else if encloses(chord, 0.35, len, b, 0.5 * shoelace.abs()) {
        // A short tail or lead-in can still end close enough to count; what was circled is the
        // loop inside it. A stroke that goes round more than once keeps its whole box.
        Ink {
            shape: Shape::Circle,
            region: (len <= 1.5 * round(b))
                .then(loop_box)
                .flatten()
                .unwrap_or(region),
            ends: None,
        }
    } else if chord > 0.88 * len {
        plain(if w > 2.5 * h {
            Shape::Underline
        } else {
            Shape::Line
        })
    } else if let Some(region) = loop_box() {
        Ink {
            shape: Shape::Circle,
            region,
            ends: None,
        }
    } else if let Some(tip) = arrow_tip(&points, w.max(h)) {
        Ink {
            shape: Shape::Arrow,
            region,
            ends: Some((norm[0], norm[tip])),
        }
    } else {
        plain(Shape::Mark)
    }
}

/// The most points [`loop_in`] tries as a loop's ends.
const MAX_LOOP_POINTS: usize = 512;

/// Ramanujan's approximation of the perimeter of the ellipse filling box `b`.
fn round(b: [f32; 4]) -> f32 {
    let (w, h) = (b[2] - b[0], b[3] - b[1]);
    PI / 2.0 * (3.0 * (w + h) - ((3.0 * w + h) * (w + 3.0 * h)).sqrt())
}

/// Whether a path (pixels) with these measures goes round something: it ends within `max_gap` of
/// its long side of where it began, is longer than twice its long side, fills a third of its box,
/// and the box's short side is over 0.42 of its long side. Flatter loops, to 5:1, count too (a
/// wide cell or a line of text is circled with a flat loop) when they also close well within
/// their short side, so a flat C doesn't, and go round at most three times (with slack for
/// jitter), so a scribble over a line of text, which closes on itself and fills its box too,
/// doesn't either.
fn encloses(gap: f32, max_gap: f32, len: f32, b: [f32; 4], area: f32) -> bool {
    let (w, h) = (b[2] - b[0], b[3] - b[1]);
    let (big, small) = (w.max(h), w.min(h));
    gap < max_gap * big
        && len > 2.0 * big
        && small >= 18.0
        && area > 0.32 * w * h
        && (small > 0.42 * big || (small > 0.2 * big && gap < 0.6 * small && len <= 3.5 * round(b)))
}

/// The loop inside a stroke (pixels) that circles something once before or after a lead-in,
/// tail or overshoot: the stretch `i..=j`, at least 0.6 of the stroke's length, whose ends meet
/// (within 0.15 of its size), that [`encloses`] its box and goes round it at most one and a half
/// times. Of several, the one whose ends meet closest.
///
/// Trying every pair of ends is quadratic and imported strokes have no point cap, so the ends
/// are tried at every `step`th point only, but each stretch is judged by the recorded path's own
/// length and area (prefix sums over every point), so sampling can't hide backtracking or turns.
fn loop_in(points: &[[f32; 2]]) -> Option<(usize, usize)> {
    let n = points.len();
    if n < 3 {
        return None;
    }
    // Length along the path, and twice the shoelace area, up to each point (f64: pixel products
    // are too big to subtract precisely in f32, and long strokes add up many segments).
    let mut run = Vec::with_capacity(n);
    let mut twice_area = Vec::with_capacity(n);
    run.push(0.0f64);
    twice_area.push(0.0f64);
    for p in points.windows(2) {
        run.push(run.last().unwrap() + distance(p[0], p[1]) as f64);
        twice_area.push(
            twice_area.last().unwrap() + p[0][0] as f64 * p[1][1] as f64
                - p[1][0] as f64 * p[0][1] as f64,
        );
    }
    let total = run[n - 1];
    let step = n.div_ceil(MAX_LOOP_POINTS);
    let mut ends: Vec<usize> = (0..n).step_by(step).collect();
    if ends.last() != Some(&(n - 1)) {
        ends.push(n - 1);
    }
    let mut best: Option<(f32, usize, usize)> = None;
    for (k, &i) in ends.iter().enumerate() {
        let a = points[i];
        let mut b = [a[0], a[1], a[0], a[1]];
        for &j in &ends[k + 1..] {
            let z = points[j];
            b = [
                b[0].min(z[0]),
                b[1].min(z[1]),
                b[2].max(z[0]),
                b[3].max(z[1]),
            ];
            let len = run[j] - run[i];
            if len < 0.6 * total {
                continue;
            }
            let gap = distance(a, z);
            let closeness = gap / (b[2] - b[0]).max(b[3] - b[1]);
            if best.is_some_and(|(c, ..)| closeness >= c) {
                continue;
            }
            let len = len as f32;
            let twice = twice_area[j] - twice_area[i] + z[0] as f64 * a[1] as f64
                - a[0] as f64 * z[1] as f64;
            if len <= 1.5 * round(b) && encloses(gap, 0.15, len, b, 0.5 * twice.abs() as f32) {
                best = Some((closeness, i, j));
            }
        }
    }
    best.map(|(_, i, j)| (i, j))
}

/// How far `p` is from the line through `a` and `b`.
fn off_line(p: [f32; 2], a: [f32; 2], b: [f32; 2]) -> f32 {
    ((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])).abs() / distance(a, b)
}

/// The tip of an arrow drawn in one stroke (pixels, `big` its box's long side): a straight shaft
/// from the first point to the tip, where the stroke turns back into one or two straight barbs
/// that end behind the tip, and the head reaches both sides of the shaft. Two barbs (out, back
/// and out again) are each at most 0.9 of the shaft; a lone barb, which must then run on across
/// the shaft, is at most 0.6 of it and clearly off it. An underline whose end hooks back to one
/// side, check marks, V's and zigzags fail.
fn arrow_tip(points: &[[f32; 2]], big: f32) -> Option<usize> {
    let start = points[0];
    // The tip is where the stroke first heads back toward its start, once half its size away.
    let mut tip = 0;
    let mut turned = false;
    for (i, &p) in points.iter().enumerate() {
        let (d, far) = (distance(start, p), distance(start, points[tip]));
        if d >= far {
            tip = i;
        } else if far >= 0.5 * big && d < 0.85 * far {
            turned = true;
            break;
        }
    }
    let t = points[tip];
    let shaft = distance(start, t);
    if !turned
        || points[..tip]
            .iter()
            .any(|&p| off_line(p, start, t) > 0.1 * shaft)
    {
        return None;
    }
    // The direction the shaft arrives in, over its last 30%.
    let arc: f32 = points[..=tip]
        .windows(2)
        .map(|p| distance(p[0], p[1]))
        .sum();
    let mut run = 0.0;
    let back = (0..tip)
        .find(|&i| {
            run += distance(points[i], points[i + 1]);
            run >= 0.7 * arc
        })
        .unwrap_or(0);
    let along = distance(points[back], t);
    if along < 1.0 {
        return None;
    }
    let dir = [
        (t[0] - points[back][0]) / along,
        (t[1] - points[back][1]) / along,
    ];
    // Barbs: runs away from the tip by at least `slack`, each from the nearest point before it.
    let slack = 0.15 * shaft;
    let mut barbs: Vec<(usize, usize)> = Vec::new();
    let (mut out, mut near, mut rising) = (tip, tip, true);
    for (i, &p) in points.iter().enumerate().skip(tip + 1) {
        if (p[0] - t[0]) * dir[0] + (p[1] - t[1]) * dir[1] > slack {
            return None;
        }
        let d = distance(t, p);
        if rising {
            if d >= distance(t, points[out]) {
                out = i;
            } else if d < distance(t, points[out]) - slack {
                barbs.push((near, out));
                (near, rising) = (i, false);
            }
        } else if d <= distance(t, points[near]) {
            near = i;
        } else if d > distance(t, points[near]) + slack {
            (out, rising) = (i, true);
        }
    }
    if rising && distance(t, points[out]) >= slack {
        barbs.push((near, out));
    }
    let cos = |deg: f32| deg.to_radians().cos();
    // Each barb's length and the cosine of its angle to the shaft pointing back.
    let mut measured = Vec::with_capacity(barbs.len());
    for (from, end) in barbs {
        let (a, z) = (points[from], points[end]);
        let span = distance(a, z);
        if points[from..=end]
            .iter()
            .any(|&p| off_line(p, a, z) > 0.15 * span)
        {
            return None;
        }
        let e = [z[0] - t[0], z[1] - t[1]];
        let d = e[0].hypot(e[1]);
        let c = -(e[0] * dir[0] + e[1] * dir[1]) / d;
        if d > 0.9 * shaft || c < cos(75.0) {
            return None;
        }
        measured.push((d, c));
    }
    let head = match measured[..] {
        [(d, c)] => d <= 0.6 * shaft && c <= cos(15.0),
        [(_, c0), (_, c1)] => c0.max(c1) <= cos(5.0),
        _ => false,
    };
    // The head spreads to both sides of the shaft; an underline that hooks back doesn't.
    let side = |p: [f32; 2]| dir[0] * (p[1] - t[1]) - dir[1] * (p[0] - t[0]);
    let reach = |sign: f32| {
        points[tip..]
            .iter()
            .map(|&p| sign * side(p))
            .fold(0.0, f32::max)
    };
    let (left, right) = (reach(1.0), reach(-1.0));
    (head && left.min(right) > 0.3 * left.max(right)).then_some(tip)
}

pub fn marks_of(strokes: &[Stroke]) -> Vec<Mark> {
    let mut groups: Vec<Vec<usize>> = Vec::new();
    for (i, stroke) in strokes.iter().enumerate().filter(|(_, s)| !s.laser) {
        if let Some(group) = groups.last_mut() {
            let prev = &strokes[*group.last().unwrap()];
            if prev.pin.is_none()
                && stroke.pin.is_none()
                && stroke.t0.saturating_sub(prev.t1) <= MARK_GAP_MS
                && group.len() < MAX_MARK_STROKES
            {
                group.push(i);
                continue;
            }
        }
        groups.push(vec![i]);
    }
    groups
        .into_iter()
        .enumerate()
        .map(|(i, group)| {
            let first = &strokes[group[0]];
            let all: Vec<_> = group
                .iter()
                .flat_map(|&j| strokes[j].normalized_points())
                .collect();
            let mut mark = Mark {
                id: format!("m{}", i + 1),
                t0: first.t0,
                t1: group
                    .iter()
                    .map(|&j| strokes[j].t1)
                    .max()
                    .unwrap_or(first.t1),
                box_norm: bounds(&all),
                shape: Shape::Mark,
                from: None,
                to: None,
                pin: first.pin,
                on: group.iter().find_map(|&j| strokes[j].on.clone()),
                strokes: group.clone(),
                description: String::new(),
                frame: None,
            };
            if first.pin.is_some() {
                let [x, y] = first
                    .normalized_points()
                    .first()
                    .copied()
                    .unwrap_or([0.0; 2]);
                mark.box_norm = [x, y, x, y];
                mark.shape = Shape::Pin;
            } else {
                let mut sized: Vec<_> = group
                    .iter()
                    .map(|&j| {
                        let s = &strokes[j];
                        let pts = s.normalized_points();
                        let b = bounds(&pts);
                        let size = (b[2] - b[0]) * s.fw as f32 + (b[3] - b[1]) * s.fh as f32;
                        (s, ink_of(s), b, pts, size)
                    })
                    .collect();
                sized.sort_by(|a, b| b.4.total_cmp(&a.4));
                let (main, ink, _, pts, _) = &sized[0];
                let shape = &ink.shape;
                let rest = &sized[1..];
                let a = pts.first().copied().unwrap_or([0.0; 2]);
                let z = pts.last().copied().unwrap_or(a);
                if matches!(shape, Shape::Line | Shape::Underline) && (1..=2).contains(&rest.len())
                {
                    let px = |p: [f32; 2]| [p[0] * main.fw as f32, p[1] * main.fh as f32];
                    let len = distance(px(a), px(z));
                    let near = |p| {
                        rest.iter().all(|r| {
                            distance(
                                px([(r.2[0] + r.2[2]) / 2.0, (r.2[1] + r.2[3]) / 2.0]),
                                px(p),
                            ) < 0.35 * len
                        })
                    };
                    if near(z) || near(a) {
                        mark.shape = Shape::Arrow;
                        mark.from = Some(if near(z) { a } else { z });
                        mark.to = Some(if near(z) { z } else { a });
                    }
                }
                if mark.shape != Shape::Arrow
                    && (rest.iter().all(|r| r.1.shape == *shape) || *shape == Shape::Circle)
                {
                    match shape {
                        Shape::Circle => {
                            mark.shape = Shape::Circle;
                            // What was circled: the loops, without any lead-in or tail.
                            mark.box_norm = if rest.iter().all(|r| r.1.shape == Shape::Circle) {
                                bounds(
                                    &sized
                                        .iter()
                                        .flat_map(|r| {
                                            let [x0, y0, x1, y1] = r.1.region;
                                            [[x0, y0], [x1, y1]]
                                        })
                                        .collect::<Vec<_>>(),
                                )
                            } else {
                                ink.region
                            };
                        }
                        Shape::Line if rest.is_empty() => {
                            mark.shape = Shape::Line;
                            mark.from = Some(a);
                            mark.to = Some(z);
                        }
                        Shape::Arrow if rest.is_empty() => {
                            mark.shape = Shape::Arrow;
                            mark.from = ink.ends.map(|e| e.0);
                            mark.to = ink.ends.map(|e| e.1);
                        }
                        Shape::Tap | Shape::Underline => mark.shape = *shape,
                        _ => {}
                    }
                }
            }
            mark.description = describe_mark(&mark);
            mark
        })
        .collect()
}

