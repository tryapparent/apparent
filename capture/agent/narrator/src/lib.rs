pub const SAMPLE_RATE: u32 = 24_000;

pub fn prepare(samples: &[f32]) -> Result<Vec<i16>, &'static str> {
    if samples.is_empty() || samples.iter().any(|s| !s.is_finite()) {
        return Err("empty or nonfinite generated audio");
    }
    // RBJ notch: 9600 Hz, Q=2.5 at 24 kHz. f64 state avoids a high-Q
    // quantisation limit cycle; state resets for each independent cue.
    let omega = std::f64::consts::TAU * 9600.0 / SAMPLE_RATE as f64;
    let alpha = omega.sin() / 5.0;
    let b0 = 1.0 / (1.0 + alpha);
    let b1 = -2.0 * omega.cos() / (1.0 + alpha);
    let a2 = (1.0 - alpha) / (1.0 + alpha);
    let (mut x1, mut x2, mut y1, mut y2) = (0.0, 0.0, 0.0, 0.0);
    Ok(samples
        .iter()
        .map(|&sample| {
            let x = sample as f64;
            let y = b0 * x + b1 * x1 + b0 * x2 - b1 * y1 - a2 * y2;
            (x2, x1, y2, y1) = (x1, x, y1, y);
            (y.clamp(-1.0, 1.0) * 32767.0).round() as i16
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tone(hz: f64) -> Vec<f32> {
        (0..48_000)
            .map(|i| (0.4 * (std::f64::consts::TAU * hz * i as f64 / 24_000.0).sin()) as f32)
            .collect()
    }
    fn gain(hz: f64) -> f64 {
        let input = tone(hz);
        let output = prepare(&input).unwrap();
        let energy_in: f64 = input[24_000..].iter().map(|&x| (x as f64).powi(2)).sum();
        let energy_out: f64 = output[24_000..]
            .iter()
            .map(|&x| (x as f64 / 32767.0).powi(2))
            .sum();
        10.0 * (energy_out / energy_in).log10()
    }
    #[test]
    fn pins_impulse_response() {
        assert_eq!(
            prepare(&[1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]).unwrap(),
            [29320, 4990, -1057, -2410, 4324, -4358, 2895, -750]
        );
    }
    #[test]
    fn rejects_invalid_audio() {
        for input in [&[][..], &[f32::NAN], &[f32::INFINITY], &[f32::NEG_INFINITY]] {
            assert!(
                prepare(input).is_err(),
                "must reject empty or nonfinite output"
            );
        }
    }
    #[test]
    fn removes_whine_without_erasing_speech_band() {
        assert!(gain(9600.0) < -70.0, "9600 Hz must be rejected");
        for hz in [9550.0, 9650.0] {
            assert!(gain(hz) < -18.0);
        }
        for hz in [100.0, 1000.0, 4000.0, 8000.0] {
            assert!(gain(hz).abs() < 0.5);
        }
    }
    #[test]
    fn pcm_saturates_without_wrapping() {
        let out = prepare(&[100.0, -100.0]).unwrap();
        assert_eq!(out[0], 32767);
        assert_eq!(out[1], -32767);
    }
}
