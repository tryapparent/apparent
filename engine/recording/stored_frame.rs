use crate::shared::model::RgbaFrame;

#[derive(Clone)]
pub(crate) struct StoredFrame {
    pub(crate) t_ms: u64,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pixels: Pixels,
}

#[derive(Clone)]
enum Pixels {
    Raw(RgbaFrame),
    #[cfg(target_os = "linux")]
    Qoi {
        encoded: Box<[u8]>,
        badge_bottom_left: bool,
    },
}

impl From<RgbaFrame> for StoredFrame {
    fn from(frame: RgbaFrame) -> Self {
        Self {
            t_ms: frame.t_ms,
            width: frame.width,
            height: frame.height,
            pixels: Pixels::Raw(frame),
        }
    }
}

impl StoredFrame {
    pub(crate) fn from_capture(frame: RgbaFrame) -> Self {
        #[cfg(target_os = "linux")]
        if let Ok(encoded) = qoi::encode_to_vec(&frame.rgba, frame.width, frame.height)
            && encoded.len() < frame.rgba.len()
        {
            return Self {
                t_ms: frame.t_ms,
                width: frame.width,
                height: frame.height,
                pixels: Pixels::Qoi {
                    encoded: encoded.into_boxed_slice(),
                    badge_bottom_left: frame.badge_bottom_left,
                },
            };
        }
        Self::from(frame)
    }

    pub(crate) fn with_rgba<T>(
        &self,
        _scratch: Option<&mut Vec<u8>>,
        read: impl FnOnce(&RgbaFrame) -> T,
    ) -> T {
        match &self.pixels {
            Pixels::Raw(frame) => read(frame),
            #[cfg(target_os = "linux")]
            Pixels::Qoi { encoded, badge_bottom_left } => {
                let Some(scratch) = _scratch else {
                    return read(&self.decode(encoded, *badge_bottom_left));
                };
                let mut decoder =
                    qoi::Decoder::new(encoded).expect("Internally encoded candidate frame");
                let mut rgba = std::mem::take(scratch);
                rgba.resize(decoder.required_buf_len(), 0);
                decoder
                    .decode_to_buf(&mut rgba)
                    .expect("Internally encoded candidate frame");
                let mut frame = RgbaFrame::new(self.t_ms, self.width, self.height, rgba);
                frame.badge_bottom_left = *badge_bottom_left;
                let result = read(&frame);
                *scratch = frame.rgba;
                result
            }
        }
    }

    pub(crate) fn to_rgba(&self) -> RgbaFrame {
        match &self.pixels {
            Pixels::Raw(frame) => frame.clone(),
            #[cfg(target_os = "linux")]
            Pixels::Qoi { encoded, badge_bottom_left } => self.decode(encoded, *badge_bottom_left),
        }
    }

    pub(crate) fn into_rgba(self) -> RgbaFrame {
        match self.pixels {
            Pixels::Raw(frame) => frame,
            #[cfg(target_os = "linux")]
            Pixels::Qoi { ref encoded, badge_bottom_left } => {
                self.decode(encoded, badge_bottom_left)
            }
        }
    }

    #[cfg(target_os = "linux")]
    fn decode(&self, encoded: &[u8], badge_bottom_left: bool) -> RgbaFrame {
        let (_, pixels) = qoi::decode_to_vec(encoded).expect("Internally encoded candidate frame");
        let mut frame = RgbaFrame::new(self.t_ms, self.width, self.height, pixels);
        frame.badge_bottom_left = badge_bottom_left;
        frame
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    #[test]
    fn compact_capture_pixels_and_geometry_round_trip() {
        let pixels = [181, 222, 4, 255, 181, 222, 4, 92].repeat(1024);
        let mut frame = RgbaFrame::new(123, 64, 32, pixels);
        frame.badge_bottom_left = true;
        let compacted = StoredFrame::from_capture(frame.clone());
        let Pixels::Qoi { encoded, .. } = &compacted.pixels else {
            panic!("Expected a compact capture frame");
        };
        assert!(encoded.len() < frame.rgba.len());
        let mut scratch = Vec::new();
        compacted.with_rgba(Some(&mut scratch), |decoded| assert_eq!(decoded.rgba, frame.rgba));

        let smaller = RgbaFrame::new(455, 24, 16, [5, 129, 44, 22].repeat(24 * 16));
        let smaller_stored = StoredFrame::from_capture(smaller.clone());
        assert!(matches!(smaller_stored.pixels, Pixels::Qoi { .. }));
        smaller_stored.with_rgba(Some(&mut scratch), |decoded| {
            assert_eq!((decoded.t_ms, decoded.width, decoded.height), (455, 24, 16));
            assert!(!decoded.badge_bottom_left);
            assert_eq!(decoded.rgba, smaller.rgba);
        });
        let decoded = compacted.into_rgba();
        assert_eq!((decoded.t_ms, decoded.width, decoded.height), (123, 64, 32));
        assert!(decoded.badge_bottom_left);
        assert_eq!(decoded.rgba, frame.rgba);
    }
}
