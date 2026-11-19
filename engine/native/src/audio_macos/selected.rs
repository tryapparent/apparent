use objc2::rc::autoreleasepool;
use objc2_av_foundation::{AVMediaTypeAudio, AVURLAsset};
use objc2_core_audio_types::kAudioFormatLinearPCM;
use objc2_foundation::{NSString, NSURL};
use std::io::Write;

use crate::{
    aac_reader::AacReader,
    aac_stream::AacStream,
    audio_mix::{self, Track},
    pcm::PcmReader,
    resample::Resampler,
};

pub(crate) fn decode(
    movie: &str,
    indices: &[usize],
    limit: u64,
    output: impl Write,
) -> Result<u64, &'static str> {
    autoreleasepool(|_| {
        let url = NSURL::fileURLWithPath(&NSString::from_str(movie));
        let asset = unsafe { AVURLAsset::URLAssetWithURL_options(&url, None) };
        #[allow(deprecated)]
        let tracks = unsafe { asset.tracks() };
        let media_type = unsafe { AVMediaTypeAudio }.ok_or("unavailable")?;
        let mut selected: Vec<Box<dyn Track>> = Vec::new();
        for &index in indices {
            if index >= tracks.count() {
                return Err("decode_failed");
            }
            let track = tracks.objectAtIndex(index);
            if &*unsafe { track.mediaType() } != media_type {
                return Err("decode_failed");
            }
            let mut reader = AacReader::new(&asset, &track)?;
            match reader.take() {
                Ok(Some(first)) => selected.push(Box::new(AacStream::new(reader, first, limit)?)),
                Ok(None) => continue,
                Err("unsupported_aac_profile") => {
                    let format = reader.unsupported.ok_or("decode_failed")?;
                    let rate = format.mSampleRate;
                    let pcm_rate = if format.mFormatID == kAudioFormatLinearPCM
                        && (1.0..=384_000.0).contains(&rate)
                        && rate.fract() == 0.0
                    {
                        rate as u32
                    } else {
                        16_000
                    };
                    let pcm = Box::new(PcmReader::new(&asset, &track, pcm_rate)?);
                    if pcm_rate == 16_000 {
                        selected.push(pcm);
                    } else {
                        selected.push(Box::new(Resampler::new(pcm, pcm_rate)?));
                    }
                }
                Err(code) => return Err(code),
            }
        }
        audio_mix::mix(selected, limit, output)
    })
}
