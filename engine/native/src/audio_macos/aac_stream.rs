use std::{
    collections::VecDeque,
    ffi::c_void,
    ptr::{self, NonNull},
};

use objc2_audio_toolbox::{
    AudioConverterDispose, AudioConverterFillComplexBuffer, AudioConverterNew, AudioConverterRef,
    AudioConverterSetProperty, kAudioConverterDecompressionMagicCookie, kAudioConverterPrimeMethod,
    kConverterPrimeMethod_None,
};
use objc2_core_audio_types::{
    AudioBuffer, AudioBufferList, AudioStreamBasicDescription, AudioStreamPacketDescription,
    kAudioFormatFlagIsFloat, kAudioFormatFlagIsPacked, kAudioFormatLinearPCM,
};

use crate::{
    aac_reader::{AacReader, Encoded},
    audio_clock::{ClockError, Packet},
    audio_mix::{Samples, Track},
};

struct Converter(AudioConverterRef);

impl Converter {
    fn new(mut source: AudioStreamBasicDescription, cookie: &[u8]) -> Result<Self, &'static str> {
        let mut destination = AudioStreamBasicDescription {
            mSampleRate: 16_000.0,
            mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked,
            mBytesPerPacket: 4,
            mFramesPerPacket: 1,
            mBytesPerFrame: 4,
            mChannelsPerFrame: 1,
            mBitsPerChannel: 32,
            mReserved: 0,
        };
        let mut raw = ptr::null_mut();
        let status = unsafe {
            AudioConverterNew(
                NonNull::from(&mut source),
                NonNull::from(&mut destination),
                NonNull::from(&mut raw),
            )
        };
        if status != 0 || raw.is_null() {
            return Err("unavailable");
        }
        let converter = Self(raw);
        let cookie_data = NonNull::new(cookie.as_ptr().cast_mut().cast()).ok_or("decode_failed")?;
        let cookie_size = u32::try_from(cookie.len()).map_err(|_| "resource_limit")?;
        if unsafe {
            AudioConverterSetProperty(
                raw,
                kAudioConverterDecompressionMagicCookie,
                cookie_size,
                cookie_data,
            )
        } != 0
        {
            return Err("decode_failed");
        }
        let mut prime = kConverterPrimeMethod_None;
        if unsafe {
            AudioConverterSetProperty(
                raw,
                kAudioConverterPrimeMethod,
                4,
                NonNull::from(&mut prime).cast(),
            )
        } != 0
        {
            return Err("decode_failed");
        }
        Ok(converter)
    }
}

impl Drop for Converter {
    fn drop(&mut self) {
        unsafe {
            AudioConverterDispose(self.0);
        }
    }
}

struct Input {
    reader: AacReader,
    first: Option<Encoded>,
    current: Option<Encoded>,
    pending: VecDeque<Packet>,
    description: AudioStreamPacketDescription,
    failure: Option<&'static str>,
    ended: bool,
}

impl Input {
    fn take(&mut self) -> Result<Option<&Encoded>, &'static str> {
        if self.pending.len() >= 1024 {
            return Err("resource_limit");
        }
        self.current = match self.first.take() {
            Some(first) => Some(first),
            None => self.reader.take()?,
        };
        if let Some(packet) = self.current.as_ref() {
            self.pending.push_back(packet.clock);
        } else {
            self.ended = true;
        }
        Ok(self.current.as_ref())
    }
}

unsafe extern "C-unwind" fn supply(
    _: AudioConverterRef,
    mut count: NonNull<u32>,
    mut data: NonNull<AudioBufferList>,
    descriptions: *mut *mut AudioStreamPacketDescription,
    user: *mut c_void,
) -> i32 {
    let input = unsafe { &mut *user.cast::<Input>() };
    let requested = unsafe { *count.as_ref() };
    unsafe { *count.as_mut() = 0 };
    if requested == 0 || input.ended {
        return 0;
    }
    let packet = match input.take() {
        Ok(Some(packet)) => packet,
        Ok(None) => return 0,
        Err(code) => {
            input.failure = Some(code);
            return -50;
        }
    };
    let buffer = AudioBuffer {
        mNumberChannels: 1,
        mDataByteSize: packet.bytes.len() as u32,
        mData: packet.bytes.as_ptr().cast_mut().cast(),
    };
    input.description.mDataByteSize = buffer.mDataByteSize;
    unsafe {
        data.as_mut().mNumberBuffers = 1;
        data.as_mut().mBuffers[0] = buffer;
        if !descriptions.is_null() {
            *descriptions = &mut input.description;
        }
        *count.as_mut() = 1;
    }
    0
}

pub(crate) struct AacStream {
    converter: Converter,
    input: Input,
    samples: [f32; 4096],
    frames: usize,
    offset: usize,
    limit: u64,
}

impl AacStream {
    pub(crate) fn new(reader: AacReader, first: Encoded, limit: u64) -> Result<Self, &'static str> {
        let (format, cookie) = reader.description()?;
        let converter = Converter::new(format, cookie)?;
        Ok(Self {
            converter,
            input: Input {
                reader,
                first: Some(first),
                current: None,
                pending: VecDeque::new(),
                description: AudioStreamPacketDescription {
                    mStartOffset: 0,
                    mVariableFramesInPacket: 0,
                    mDataByteSize: 0,
                },
                failure: None,
                ended: false,
            },
            samples: [0.0; 4096],
            frames: 0,
            offset: 0,
            limit,
        })
    }

    fn refill(&mut self) -> Result<bool, &'static str> {
        for _ in 0..8 {
            let mut count = self.samples.len() as u32;
            let mut output = AudioBufferList {
                mNumberBuffers: 1,
                mBuffers: [AudioBuffer {
                    mNumberChannels: 1,
                    mDataByteSize: count * 4,
                    mData: self.samples.as_mut_ptr().cast(),
                }],
            };
            let status = unsafe {
                AudioConverterFillComplexBuffer(
                    self.converter.0,
                    Some(supply),
                    (&mut self.input as *mut Input).cast(),
                    NonNull::from(&mut count),
                    NonNull::from(&mut output),
                    ptr::null_mut(),
                )
            };
            if let Some(code) = self.input.failure {
                return Err(code);
            }
            if status != 0
                || count as usize > self.samples.len()
                || output.mBuffers[0].mDataByteSize != count * 4
            {
                return Err("decode_failed");
            }
            if count > 0 {
                self.offset = 0;
                self.frames = count as usize;
                return Ok(true);
            }
            if self.input.ended {
                return Ok(false);
            }
        }
        Err("decode_failed")
    }
}

impl Track for AacStream {
    fn next(&mut self) -> Result<Option<Samples>, &'static str> {
        objc2::rc::autoreleasepool(|_| self.next_chunk())
    }
}

impl AacStream {
    fn next_chunk(&mut self) -> Result<Option<Samples>, &'static str> {
        loop {
            if self.offset == self.frames && !self.refill()? {
                return if self.input.pending.is_empty() {
                    Ok(None)
                } else {
                    Err("decode_failed")
                };
            }
            let packet = self.input.pending.pop_front().ok_or("decode_failed")?;
            let span = packet.span(self.limit).map_err(|error| match error {
                ClockError::ResourceLimit => "resource_limit",
                _ => "decode_failed",
            })?;
            let mut local = 0;
            let mut selected = Vec::new();
            while local < packet.decoded_frames {
                if self.offset == self.frames && !self.refill()? {
                    return Err("decode_failed");
                }
                let count = (self.frames - self.offset).min(packet.decoded_frames - local);
                let samples = &self.samples[self.offset..self.offset + count];
                if samples.iter().any(|sample| !sample.is_finite()) {
                    return Err("decode_failed");
                }
                if let Some(span) = &span {
                    let start = local.max(span.first);
                    let end = (local + count).min(span.first + span.count);
                    if end > start {
                        selected.extend_from_slice(&samples[start - local..end - local]);
                    }
                }
                local += count;
                self.offset += count;
            }
            if let Some(span) = span {
                return Ok(Some(Samples {
                    start: span.start,
                    values: selected,
                }));
            }
        }
    }
}
