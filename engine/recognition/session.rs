use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use crate::capture::engine::{autocrop::autocrop, sketch};
use crate::shared::model::{RgbaFrame, Shape, Stroke};

pub(crate) const SETTING: &str = "circleLabels";

type Recognizer = fn(&RgbaFrame, &[[f32; 2]]) -> Option<String>;

struct Job {
    generation: u64,
    frame: Arc<RgbaFrame>,
    stroke: Stroke,
}

#[derive(Default)]
struct Samples {
    generation: u64,
    latest: Option<(Instant, Arc<RgbaFrame>)>,
    before: Option<(u64, Arc<RgbaFrame>)>,
}

pub(crate) struct Session {
    samples: Mutex<Samples>,
    queue: flume::Sender<Job>,
    labels: flume::Receiver<(u64, u64, String)>,
}

impl Session {
    pub(crate) fn start(recognizer: Recognizer) -> Option<Arc<Self>> {
        let (queue, jobs) = flume::bounded::<Job>(1);
        let (sender, labels) = flume::bounded(256);
        std::thread::Builder::new()
            .name("apparent-circle-labels".into())
            .spawn(move || {
                while let Ok(job) = jobs.recv() {
                    if jobs.is_disconnected() || sender.is_disconnected() {
                        break;
                    }
                    if let Some(label) = recognize(&job, recognizer) {
                        let _ = sender.try_send((job.generation, job.stroke.t0, label));
                    }
                }
            })
            .ok()?;
        Some(Arc::new(Self {
            samples: Mutex::default(),
            queue,
            labels,
        }))
    }

    pub(crate) fn sample(&self, frame: RgbaFrame) {
        self.samples
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .latest = Some((Instant::now(), Arc::new(frame)));
    }

    pub(crate) fn clear_samples(&self) {
        let mut samples = self.samples.lock().unwrap_or_else(PoisonError::into_inner);
        *samples = Samples {
            generation: samples.generation + 1,
            ..Samples::default()
        };
    }

    pub(crate) fn begin_mark(&self, time: u64) {
        let mut samples = self.samples.lock().unwrap_or_else(PoisonError::into_inner);
        samples.before = samples
            .latest
            .as_ref()
            .filter(|(at, _)| at.elapsed() < Duration::from_millis(750))
            .map(|(_, frame)| (time, Arc::clone(frame)));
    }

    pub(crate) fn end_mark(&self, stroke: &Stroke) {
        let mut samples = self.samples.lock().unwrap_or_else(PoisonError::into_inner);
        let generation = samples.generation;
        let before = samples.before.take();
        drop(samples);
        if let Some((time, frame)) = before
            && time == stroke.t0
        {
            let _ = self.queue.try_send(Job {
                generation,
                frame,
                stroke: stroke.clone(),
            });
        }
    }

    pub(crate) fn apply(&self, strokes: &mut [Stroke]) {
        let generation = self
            .samples
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .generation;
        let labels: HashMap<_, _> = self
            .labels
            .try_iter()
            .filter_map(|(sample, time, label)| (sample == generation).then_some((time, label)))
            .collect();
        if labels.is_empty() {
            return;
        }
        for mark in sketch::marks_of(strokes) {
            if mark.shape != Shape::Circle || mark.on.is_some() {
                continue;
            }
            let mut matched = mark.strokes.iter().map(|i| labels.get(&strokes[*i].t0));
            if let Some(Some(first)) = matched.next()
                && matched.all(|label| label == Some(first))
            {
                strokes[mark.strokes[0]].on = Some(first.clone());
            }
        }
    }
}

fn recognize(job: &Job, recognizer: Recognizer) -> Option<String> {
    let mark = sketch::marks_of(std::slice::from_ref(&job.stroke)).pop()?;
    if mark.shape != Shape::Circle {
        return None;
    }
    let frame = &job.frame;
    let [x, y, width, height] = autocrop::pixel_rect(mark.box_norm, frame.width, frame.height);
    if width < 8 || height < 8 || width as u64 * height as u64 > 1_500_000 {
        return None;
    }
    let points: Vec<_> = job
        .stroke
        .normalized_points()
        .into_iter()
        .map(|[a, b]| {
            [
                a * frame.width as f32 - x as f32,
                b * frame.height as f32 - y as f32,
            ]
        })
        .collect();
    let crop = autocrop::crop_frame(frame, mark.box_norm);
    recognizer(&crop, &points)
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
