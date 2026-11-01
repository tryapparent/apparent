use apparent_narrator::{SAMPLE_RATE, prepare};
use loqui_kokoro::{Device, Kokoro, KokoroModel};
use std::{error::Error, fs, io::BufWriter, path::PathBuf};

fn run() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() != 3 {
        return Err("usage: apparent-narrator MODEL_DIRECTORY TEXT_FILE OUTPUT_WAV".into());
    }
    let directory = PathBuf::from(&args[0]);
    let text = fs::read_to_string(&args[1])?;
    if text.trim().is_empty() {
        return Err("cue text is empty".into());
    }
    let output = PathBuf::from(&args[2]);
    if output.symlink_metadata().is_ok() {
        return Err("output already exists; choose a fresh WAV path".into());
    }
    let started = std::time::Instant::now();
    let model = KokoroModel::load(&directory.join("model.onnx"), Device::Cpu, Some(3))?;
    let tts = Kokoro::new(model, directory.join("voices"), Default::default());
    let pcm = prepare(&tts.speak_raw(&text, &"bm_fable".parse()?, 1.0)?)?;
    // create_new refuses existing files and symlinks, including a racing writer.
    let file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&output)?;
    let result = (|| -> Result<(), Box<dyn Error>> {
        let mut wav = hound::WavWriter::new(
            BufWriter::new(file),
            hound::WavSpec {
                channels: 1,
                sample_rate: SAMPLE_RATE,
                bits_per_sample: 16,
                sample_format: hound::SampleFormat::Int,
            },
        )?;
        for &sample in &pcm {
            wav.write_sample(sample)?;
        }
        wav.finalize()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&output);
    }
    result?;
    eprintln!(
        "narrator: {} samples, {:.3}s audio, {:.3}s elapsed",
        pcm.len(),
        pcm.len() as f64 / SAMPLE_RATE as f64,
        started.elapsed().as_secs_f64()
    );
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("apparent-narrator: {error}");
        std::process::exit(1);
    }
}
