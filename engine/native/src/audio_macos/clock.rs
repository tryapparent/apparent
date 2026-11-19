use objc2_core_foundation::{CFDictionary, CFNumber};
use objc2_core_media::{
    CMGetAttachment, CMSampleBuffer, CMSampleTimingInfo, CMTime, CMTimeFlags,
    kCMSampleBufferAttachmentKey_SpeedMultiplier, kCMSampleBufferAttachmentKey_TrimDurationAtStart,
    kCMTimeInvalid,
};
use std::ptr;

use crate::audio_clock::Packet;

pub(crate) fn sample_time(time: CMTime) -> Result<i64, &'static str> {
    sample_time_at(time, 16_000)
}

pub(crate) fn sample_time_at(time: CMTime, rate: u32) -> Result<i64, &'static str> {
    let CMTime {
        value,
        timescale,
        flags,
        epoch,
    } = time;
    if !flags.contains(CMTimeFlags::Valid)
        || flags.intersects(CMTimeFlags::ImpliedValueFlagsMask)
        || epoch != 0
        || timescale <= 0
    {
        return Err("invalid Apple movie time");
    }
    let ticks = i128::from(value) * i128::from(rate);
    let scale = i128::from(timescale);
    let samples = (ticks.abs() + scale / 2) / scale * ticks.signum();
    samples.try_into().map_err(|_| "Apple movie time overflow")
}

pub fn packets(
    buffer: &CMSampleBuffer,
    frames_per_packet: usize,
) -> Result<Vec<Packet>, &'static str> {
    let count = unsafe { buffer.num_samples() };
    if !(1..=262_144).contains(&count) || !(1..=65_536).contains(&frames_per_packet) {
        return Err("unsupported encoded packet count");
    }
    if let Some(speed) = unsafe {
        CMGetAttachment(
            buffer,
            kCMSampleBufferAttachmentKey_SpeedMultiplier,
            ptr::null_mut(),
        )
    } {
        if speed.downcast_ref::<CFNumber>().and_then(CFNumber::as_f64) != Some(1.0) {
            return Err("unsupported Apple movie rate mapping");
        }
    }
    let mut trim = match unsafe {
        CMGetAttachment(
            buffer,
            kCMSampleBufferAttachmentKey_TrimDurationAtStart,
            ptr::null_mut(),
        )
    } {
        Some(value) => {
            let dictionary = value
                .downcast_ref::<CFDictionary>()
                .ok_or("invalid Apple trim metadata")?;
            let time = unsafe { CMTime::from_dictionary(Some(dictionary)) };
            usize::try_from(sample_time(time)?).map_err(|_| "invalid Apple leading trim")?
        }
        None => 0,
    };
    let mut entries = 0;
    if unsafe { buffer.output_sample_timing_info_array(0, ptr::null_mut(), &mut entries) } != 0
        || (entries != 1 && entries != count)
    {
        return Err("unsupported Apple sample timing layout");
    }
    let invalid = unsafe { kCMTimeInvalid };
    let mut timings = vec![
        CMSampleTimingInfo {
            duration: invalid,
            presentationTimeStamp: invalid,
            decodeTimeStamp: invalid,
        };
        entries as usize
    ];
    if unsafe {
        buffer.output_sample_timing_info_array(entries, timings.as_mut_ptr(), ptr::null_mut())
    } != 0
    {
        return Err("could not read Apple sample timings");
    }
    let mut packets = Vec::with_capacity(count as usize);
    for index in 0..count as usize {
        let timing = &timings[if entries == 1 { 0 } else { index }];
        let duration =
            u64::try_from(sample_time(timing.duration)?).map_err(|_| "negative sample duration")?;
        let start = if duration == 0 {
            0
        } else {
            let base = timing.presentationTimeStamp;
            let exact = if entries == 1 && index > 0 {
                unsafe { base.add(timing.duration.multiply(index as i32)) }
            } else {
                base
            };
            sample_time(exact)?
        };
        let leading_trim = trim.min(frames_per_packet);
        trim -= leading_trim;
        packets.push(Packet {
            movie_start: start,
            movie_duration: duration,
            decoded_frames: frames_per_packet,
            leading_trim,
        });
    }
    if trim != 0 {
        return Err("Apple leading trim exceeds the encoded buffer");
    }
    Ok(packets)
}
