use objc2::{rc::Retained, runtime::AnyObject};
use objc2_av_foundation::{
    AVAsset, AVAssetReader, AVAssetReaderAudioMixOutput, AVAssetReaderStatus, AVAssetTrack,
    AVAudioMixInputParameters, AVMutableAudioMix, AVMutableAudioMixInputParameters,
};
use objc2_avf_audio::{
    AVFormatIDKey, AVLinearPCMBitDepthKey, AVLinearPCMIsBigEndianKey, AVLinearPCMIsFloatKey,
    AVLinearPCMIsNonInterleaved, AVNumberOfChannelsKey, AVSampleRateKey,
};
use objc2_core_audio_types::{
    kAudioFormatFlagIsBigEndian, kAudioFormatFlagIsFloat, kAudioFormatLinearPCM,
};
use objc2_core_media::{CMAudioFormatDescriptionGetStreamBasicDescription, kCMTimeZero};
use objc2_foundation::{NSArray, NSDictionary, NSNumber};
use std::ptr::NonNull;

use crate::audio_mix::{Samples, Track};
use crate::clock::sample_time_at;

pub struct PcmReader {
    reader: Retained<AVAssetReader>,
    output: Retained<AVAssetReaderAudioMixOutput>,
    end: u64,
    rate: u32,
}

impl PcmReader {
    pub fn new(asset: &AVAsset, track: &AVAssetTrack, rate: u32) -> Result<Self, &'static str> {
        let reader = unsafe { AVAssetReader::assetReaderWithAsset_error(asset) }
            .map_err(|_| "decode_failed")?;
        let tracks = NSArray::from_slice(&[track]);
        let keys = unsafe {
            [
                AVFormatIDKey,
                AVSampleRateKey,
                AVNumberOfChannelsKey,
                AVLinearPCMBitDepthKey,
                AVLinearPCMIsFloatKey,
                AVLinearPCMIsBigEndianKey,
                AVLinearPCMIsNonInterleaved,
            ]
        };
        let keys: Vec<_> = keys
            .into_iter()
            .collect::<Option<_>>()
            .ok_or("unavailable")?;
        let values = [
            NSNumber::new_u32(kAudioFormatLinearPCM),
            NSNumber::new_u32(rate),
            NSNumber::new_u32(1),
            NSNumber::new_u32(32),
            NSNumber::new_bool(true),
            NSNumber::new_bool(false),
            NSNumber::new_bool(false),
        ];
        let values: Vec<&AnyObject> = values.iter().map(|value| -> &AnyObject { value }).collect();
        let settings = NSDictionary::from_slices(&keys, &values);
        let output = unsafe {
            AVAssetReaderAudioMixOutput::assetReaderAudioMixOutputWithAudioTracks_audioSettings(
                &tracks,
                Some(&settings),
            )
        };
        unsafe {
            let mix = AVMutableAudioMix::audioMix();
            let input =
                AVMutableAudioMixInputParameters::audioMixInputParametersWithTrack(Some(track));
            input.setVolume_atTime(1.0, kCMTimeZero);
            let base: &AVAudioMixInputParameters = &input;
            mix.setInputParameters(&NSArray::from_slice(&[base]));
            output.setAudioMix(Some(&mix));
            if !reader.canAddOutput(&output) {
                return Err("Apple PCM output unavailable");
            }
            reader.addOutput(&output);
            if !reader.startReading() {
                return Err("Apple PCM reader refused start");
            }
        }
        Ok(Self {
            reader,
            output,
            end: 0,
            rate,
        })
    }
}

impl Drop for PcmReader {
    fn drop(&mut self) {
        unsafe { self.reader.cancelReading() };
    }
}

impl Track for PcmReader {
    fn next(&mut self) -> Result<Option<Samples>, &'static str> {
        objc2::rc::autoreleasepool(|_| self.next_chunk())
    }
}

impl PcmReader {
    fn next_chunk(&mut self) -> Result<Option<Samples>, &'static str> {
        for _ in 0..1024 {
            let Some(buffer) = (unsafe { self.output.copyNextSampleBuffer() }) else {
                return if unsafe { self.reader.status() } == AVAssetReaderStatus::Completed {
                    Ok(None)
                } else {
                    Err("decode_failed")
                };
            };
            let count = unsafe { buffer.num_samples() };
            if count == 0 {
                continue;
            }
            if !(1..=1_048_576).contains(&count) {
                return Err("resource_limit");
            }
            let description = unsafe { buffer.format_description() }.ok_or("decode_failed")?;
            let format =
                unsafe { CMAudioFormatDescriptionGetStreamBasicDescription(&description).as_ref() }
                    .ok_or("decode_failed")?;
            if format.mFormatID != kAudioFormatLinearPCM
                || format.mSampleRate != f64::from(self.rate)
                || format.mChannelsPerFrame != 1
                || format.mBitsPerChannel != 32
                || format.mBytesPerFrame != 4
                || format.mFormatFlags & kAudioFormatFlagIsFloat == 0
                || format.mFormatFlags & kAudioFormatFlagIsBigEndian != 0
            {
                return Err("Apple PCM output format mismatch");
            }
            let data = unsafe { buffer.data_buffer() }.ok_or("decode_failed")?;
            if unsafe { data.data_length() } != count as usize * 4 {
                return Err("Apple PCM output size mismatch");
            }
            let first = sample_time_at(unsafe { buffer.presentation_time_stamp() }, self.rate)?;
            let start = self.end.max(first.max(0) as u64);
            let skip = (i128::from(start) - i128::from(first)) as u128;
            if skip >= count as u128 {
                continue;
            }
            let frames = count as usize - skip as usize;
            let mut bytes = vec![0_u8; frames * 4];
            let destination = NonNull::new(bytes.as_mut_ptr().cast()).ok_or("decode_failed")?;
            if unsafe { data.copy_data_bytes(skip as usize * 4, bytes.len(), destination) } != 0 {
                return Err("Apple PCM copy failed");
            }
            let values = bytes
                .chunks_exact(4)
                .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
                .collect();
            self.end = start.checked_add(frames as u64).ok_or("resource_limit")?;
            return Ok(Some(Samples { start, values }));
        }
        Err("resource_limit")
    }
}
