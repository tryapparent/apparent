use std::{
    ffi::c_void,
    ptr::{self, NonNull},
};

use objc2_audio_toolbox::{
    AudioConverterDispose, AudioConverterFillComplexBuffer, AudioConverterNew, AudioConverterRef,
    AudioConverterSetProperty, kAudioConverterQuality_Max,
    kAudioConverterSampleRateConverterComplexity,
    kAudioConverterSampleRateConverterComplexity_Mastering,
    kAudioConverterSampleRateConverterQuality,
};
use objc2_core_audio_types::{
    AudioBuffer, AudioBufferList, AudioStreamBasicDescription, AudioStreamPacketDescription,
    kAudioFormatFlagIsFloat, kAudioFormatFlagIsPacked, kAudioFormatLinearPCM,
};

use crate::audio_mix::{Samples, Track};

struct Input {
    track: Box<dyn Track>,
    current: Option<Samples>,
    cursor: u64,
    origin: Option<u64>,
    scratch: [f32; 4096],
    ended: bool,
    failure: Option<&'static str>,
}

impl Input {
    fn fill(&mut self, requested: usize) -> Result<usize, &'static str> {
        if self.ended || requested == 0 {
            return Ok(0);
        }
        if self
            .current
            .as_ref()
            .is_none_or(|block| self.cursor >= block.start + block.values.len() as u64)
        {
            self.current = self.track.next()?;
            let Some(block) = &self.current else {
                self.ended = true;
                return Ok(0);
            };
            if block.values.is_empty()
                || block.start < self.cursor
                || block.start.checked_add(block.values.len() as u64).is_none()
            {
                return Err("decode_failed");
            }
            if self.origin.is_none() {
                self.origin = Some(block.start);
                self.cursor = block.start;
            }
        }
        let block = self.current.as_ref().ok_or("decode_failed")?;
        let max = requested.min(self.scratch.len());
        let count = if self.cursor < block.start {
            let count = (block.start - self.cursor).min(max as u64) as usize;
            self.scratch[..count].fill(0.0);
            count
        } else {
            let offset = (self.cursor - block.start) as usize;
            let count = max.min(block.values.len() - offset);
            self.scratch[..count].copy_from_slice(&block.values[offset..offset + count]);
            count
        };
        self.cursor += count as u64;
        Ok(count)
    }
}

unsafe extern "C-unwind" fn supply(
    _: AudioConverterRef,
    mut count: NonNull<u32>,
    mut data: NonNull<AudioBufferList>,
    _: *mut *mut AudioStreamPacketDescription,
    user: *mut c_void,
) -> i32 {
    let input = unsafe { &mut *user.cast::<Input>() };
    let requested = unsafe { *count.as_ref() } as usize;
    let frames = match input.fill(requested) {
        Ok(count) => count as u32,
        Err(code) => {
            input.failure = Some(code);
            unsafe { *count.as_mut() = 0 };
            return -50;
        }
    };
    unsafe {
        *count.as_mut() = frames;
        data.as_mut().mNumberBuffers = 1;
        data.as_mut().mBuffers[0] = AudioBuffer {
            mNumberChannels: 1,
            mDataByteSize: frames * 4,
            mData: input.scratch.as_mut_ptr().cast(),
        };
    }
    0
}

fn float_format(rate: u32) -> AudioStreamBasicDescription {
    AudioStreamBasicDescription {
        mSampleRate: f64::from(rate),
        mFormatID: kAudioFormatLinearPCM,
        mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked,
        mBytesPerPacket: 4,
        mFramesPerPacket: 1,
        mBytesPerFrame: 4,
        mChannelsPerFrame: 1,
        mBitsPerChannel: 32,
        mReserved: 0,
    }
}

pub(crate) struct Resampler {
    converter: AudioConverterRef,
    input: Input,
    source_rate: u32,
    produced: u64,
}

impl Resampler {
    pub(crate) fn new(track: Box<dyn Track>, source_rate: u32) -> Result<Self, &'static str> {
        let mut source = float_format(source_rate);
        let mut destination = float_format(16_000);
        let mut converter = ptr::null_mut();
        let status = unsafe {
            AudioConverterNew(
                NonNull::from(&mut source),
                NonNull::from(&mut destination),
                NonNull::from(&mut converter),
            )
        };
        if status != 0 || converter.is_null() {
            return Err("unavailable");
        }
        let result = Self {
            converter,
            input: Input {
                track,
                current: None,
                cursor: 0,
                origin: None,
                scratch: [0.0; 4096],
                ended: false,
                failure: None,
            },
            source_rate,
            produced: 0,
        };
        for (key, mut value) in [
            (
                kAudioConverterSampleRateConverterComplexity,
                kAudioConverterSampleRateConverterComplexity_Mastering,
            ),
            (
                kAudioConverterSampleRateConverterQuality,
                kAudioConverterQuality_Max,
            ),
        ] {
            if unsafe {
                AudioConverterSetProperty(converter, key, 4, NonNull::from(&mut value).cast())
            } != 0
            {
                return Err("decode_failed");
            }
        }
        Ok(result)
    }

    fn next_chunk(&mut self) -> Result<Option<Samples>, &'static str> {
        let mut values = vec![0.0_f32; 8192];
        for _ in 0..8 {
            let mut frames = values.len() as u32;
            let mut output = AudioBufferList {
                mNumberBuffers: 1,
                mBuffers: [AudioBuffer {
                    mNumberChannels: 1,
                    mDataByteSize: frames * 4,
                    mData: values.as_mut_ptr().cast(),
                }],
            };
            let status = unsafe {
                AudioConverterFillComplexBuffer(
                    self.converter,
                    Some(supply),
                    (&mut self.input as *mut Input).cast(),
                    NonNull::from(&mut frames),
                    NonNull::from(&mut output),
                    ptr::null_mut(),
                )
            };
            if let Some(code) = self.input.failure {
                return Err(code);
            }
            if status != 0
                || frames as usize > values.len()
                || frames * 4 != output.mBuffers[0].mDataByteSize
            {
                return Err("decode_failed");
            }
            if frames == 0 {
                if self.input.ended {
                    return Ok(None);
                }
                continue;
            }
            let rate = u128::from(self.source_rate);
            let origin = u128::from(self.input.origin.ok_or("decode_failed")?);
            let mapped: u64 = ((origin * 16_000 + rate / 2) / rate)
                .try_into()
                .map_err(|_| "resource_limit")?;
            let start = mapped.checked_add(self.produced).ok_or("resource_limit")?;
            self.produced = self
                .produced
                .checked_add(u64::from(frames))
                .ok_or("resource_limit")?;
            values.truncate(frames as usize);
            return Ok(Some(Samples { start, values }));
        }
        Err("decode_failed")
    }
}

impl Track for Resampler {
    fn next(&mut self) -> Result<Option<Samples>, &'static str> {
        self.next_chunk()
    }
}

impl Drop for Resampler {
    fn drop(&mut self) {
        unsafe {
            AudioConverterDispose(self.converter);
        }
    }
}
