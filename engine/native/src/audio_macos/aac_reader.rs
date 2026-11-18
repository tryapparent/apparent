use std::{collections::VecDeque, ptr::NonNull};

use objc2::rc::Retained;
use objc2_av_foundation::{
    AVAsset, AVAssetReader, AVAssetReaderStatus, AVAssetReaderTrackOutput, AVAssetTrack,
};
use objc2_core_audio_types::{AudioStreamBasicDescription, kAudioFormatMPEG4AAC};
use objc2_core_media::{
    CMAudioFormatDescriptionGetMagicCookie, CMAudioFormatDescriptionGetStreamBasicDescription,
    CMSampleBuffer,
};

use crate::{audio_clock::Packet, clock};

pub(crate) struct Encoded {
    pub(crate) clock: Packet,
    pub(crate) bytes: Vec<u8>,
}

pub(crate) struct AacReader {
    reader: Retained<AVAssetReader>,
    output: Retained<AVAssetReaderTrackOutput>,
    description: Option<(AudioStreamBasicDescription, Vec<u8>)>,
    buffer: Option<Retained<CMSampleBuffer>>,
    pub(crate) unsupported: Option<AudioStreamBasicDescription>,
    clock: VecDeque<Packet>,
    packet_index: isize,
    byte_offset: usize,
    byte_length: usize,
}

impl AacReader {
    pub(crate) fn new(asset: &AVAsset, track: &AVAssetTrack) -> Result<Self, &'static str> {
        let reader = unsafe { AVAssetReader::assetReaderWithAsset_error(asset) }
            .map_err(|_| "decode_failed")?;
        let output = unsafe {
            AVAssetReaderTrackOutput::assetReaderTrackOutputWithTrack_outputSettings(track, None)
        };
        unsafe {
            if !reader.canAddOutput(&output) {
                return Err("decode_failed");
            }
            reader.addOutput(&output);
            if !reader.startReading() {
                return Err("decode_failed");
            }
        }
        Ok(Self {
            reader,
            output,
            description: None,
            unsupported: None,
            buffer: None,
            clock: VecDeque::new(),
            packet_index: 0,
            byte_offset: 0,
            byte_length: 0,
        })
    }

    fn refill(&mut self) -> Result<bool, &'static str> {
        for _ in 0..1024 {
            let Some(buffer) = (unsafe { self.output.copyNextSampleBuffer() }) else {
                return if unsafe { self.reader.status() } == AVAssetReaderStatus::Completed {
                    Ok(false)
                } else {
                    Err("decode_failed")
                };
            };
            if unsafe { buffer.num_samples() } == 0 {
                continue;
            }
            let description = unsafe { buffer.format_description() }.ok_or("decode_failed")?;
            let format =
                unsafe { CMAudioFormatDescriptionGetStreamBasicDescription(&description).as_ref() }
                    .ok_or("decode_failed")?;
            if format.mFormatID != kAudioFormatMPEG4AAC
                || format.mSampleRate != 16_000.0
                || format.mChannelsPerFrame != 1
                || format.mFramesPerPacket != 1024
            {
                return if self.description.is_none() {
                    self.unsupported = Some(*format);
                    Err("unsupported_aac_profile")
                } else {
                    Err("decode_failed")
                };
            }
            let mut cookie_size = 0;
            let cookie =
                unsafe { CMAudioFormatDescriptionGetMagicCookie(&description, &mut cookie_size) };
            if cookie.is_null() || !(1..=8192).contains(&cookie_size) {
                return Err("decode_failed");
            }
            let cookie = unsafe { std::slice::from_raw_parts(cookie.cast::<u8>(), cookie_size) };
            if let Some((initial, initial_cookie)) = &self.description {
                if initial != format || initial_cookie.as_slice() != cookie {
                    return Err("decode_failed");
                }
            } else {
                self.description = Some((*format, cookie.to_vec()));
            }
            self.clock = clock::packets(&buffer, format.mFramesPerPacket as usize)?.into();
            let data = unsafe { buffer.data_buffer() }.ok_or("decode_failed")?;
            self.byte_length = unsafe { data.data_length() };
            self.packet_index = 0;
            self.byte_offset = 0;
            self.buffer = Some(buffer);
            return Ok(true);
        }
        Err("resource_limit")
    }

    pub(crate) fn take(&mut self) -> Result<Option<Encoded>, &'static str> {
        if self.clock.is_empty() && !self.refill()? {
            return Ok(None);
        }
        let buffer = self.buffer.as_ref().ok_or("decode_failed")?;
        let length = unsafe { buffer.sample_size(self.packet_index) };
        if length == 0 || length > self.byte_length - self.byte_offset || length > 65_536 {
            return Err("decode_failed");
        }
        let block = unsafe { buffer.data_buffer() }.ok_or("decode_failed")?;
        let mut bytes = vec![0; length];
        let data = NonNull::new(bytes.as_mut_ptr().cast()).ok_or("decode_failed")?;
        if unsafe { block.copy_data_bytes(self.byte_offset, length, data) } != 0 {
            return Err("decode_failed");
        }
        self.byte_offset += length;
        self.packet_index += 1;
        let clock = self.clock.pop_front().ok_or("decode_failed")?;
        if self.clock.is_empty() && self.byte_offset != self.byte_length {
            return Err("decode_failed");
        }
        Ok(Some(Encoded { clock, bytes }))
    }

    pub(crate) fn description(&self) -> Result<(AudioStreamBasicDescription, &[u8]), &'static str> {
        let (format, cookie) = self.description.as_ref().ok_or("decode_failed")?;
        Ok((*format, cookie))
    }
}

impl Drop for AacReader {
    fn drop(&mut self) {
        unsafe { self.reader.cancelReading() };
    }
}
