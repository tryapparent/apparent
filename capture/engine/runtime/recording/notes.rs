use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[path = "../../../../engine/native/notes/lifecycle.rs"]
pub(crate) mod lifecycle;

pub const MAX_TEXT_BYTES: usize = 8_192;
const MAX_NOTES: usize = 100;
const MAX_SAVED_BYTES: usize = MAX_NOTES * MAX_TEXT_BYTES * 6 + 65_536;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Note {
    pub pin: u32,
    pub t: u64,
    pub x: f32,
    pub y: f32,
    pub text: String,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Saved {
    version: u32,
    notes: Vec<Note>,
}

/// Unsubmitted drafts stay local to the running capture, never in exported media/text.
pub struct Store {
    path: PathBuf,
    saved: Vec<Note>,
    drafts: std::collections::BTreeMap<u32, Note>,
}
impl Store {
    pub fn new(directory: &Path) -> Self {
        Self {
            path: directory.join("notes.json"),
            saved: Vec::new(),
            drafts: Default::default(),
        }
    }
    pub fn open(&mut self, pin: u32, t: u64, x: f32, y: f32) -> Result<()> {
        ensure!(self.saved.len() < MAX_NOTES, "Too many notes");
        ensure!(!self.saved.iter().any(|note| note.pin == pin), "Note is already attached");
        ensure!(
            pin > 0
                && x.is_finite()
                && y.is_finite()
                && (0.0..=1.0).contains(&x)
                && (0.0..=1.0).contains(&y),
            "Invalid note anchor"
        );
        self.dismiss();
        self.drafts.insert(pin, Note {
            pin,
            t,
            x,
            y,
            text: String::new(),
        });
        Ok(())
    }
    pub fn draft(&mut self, pin: u32, text: String) -> Result<()> {
        ensure!(
            text.len() <= MAX_TEXT_BYTES && !text.contains('\0'),
            "Note is too long"
        );
        self.drafts
            .get_mut(&pin)
            .ok_or_else(|| anyhow::anyhow!("Unknown note"))?
            .text = text;
        Ok(())
    }
    pub fn save(&mut self, pin: u32, text: String) -> Result<()> {
        if self.saved.iter().any(|note| note.pin == pin) {
            return Ok(());
        }
        self.draft(pin, text)?;
        let mut note = self.drafts[&pin].clone();
        note.text = note.text.trim().to_owned();
        if note.text.is_empty() {
            self.dismiss();
            return Ok(());
        }
        let mut next = self.saved.clone();
        next.push(note);
        next.sort_by_key(|n| (n.t, n.pin));
        self.commit(next)?;
        self.dismiss();
        Ok(())
    }
    pub fn dismiss(&mut self) {
        self.drafts.clear();
    }
    fn commit(&mut self, next: Vec<Note>) -> Result<()> {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let temp = self.path.with_file_name(format!(
            ".notes-{}.tmp",
            crate::shared::ids::make_bundle_id()
        ));
        let result = (|| {
            let mut f = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&temp)?;
            f.write_all(&serde_json::to_vec(&Saved {
                version: 1,
                notes: next.clone(),
            })?)?;
            f.sync_all()?;
            std::fs::rename(&temp, &self.path)?;
            std::fs::File::open(self.path.parent().unwrap())?.sync_all()?;
            Ok::<_, anyhow::Error>(())
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(temp);
        }
        result?;
        self.saved = next;
        Ok(())
    }
    pub fn notes(&self) -> &[Note] {
        &self.saved
    }
    pub fn drafts(&self) -> Vec<Note> {
        self.drafts.values().cloned().collect()
    }
}

pub fn read(directory: &Path) -> Result<Vec<Note>> {
    let path = directory.join("notes.json");
    use std::io::Read;
    use std::os::unix::fs::OpenOptionsExt;
    let data = match std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(&path)
    {
        Ok(file) => {
            ensure!(file.metadata()?.is_file(), "Notes must be a regular file");
            let mut data = Vec::new();
            file.take((MAX_SAVED_BYTES + 1) as u64)
                .read_to_end(&mut data)?;
            data
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    ensure!(data.len() <= MAX_SAVED_BYTES, "Notes file is too large");
    let saved: Saved = serde_json::from_slice(&data)?;
    ensure!(
        saved.version == 1 && saved.notes.len() <= MAX_NOTES,
        "Unsupported notes file"
    );
    let mut pins = std::collections::BTreeSet::new();
    for n in &saved.notes {
        ensure!(
            n.pin > 0
                && pins.insert(n.pin)
                && n.x.is_finite()
                && n.y.is_finite()
                && (0.0..=1.0).contains(&n.x)
                && (0.0..=1.0).contains(&n.y)
                && n.text.len() <= MAX_TEXT_BYTES
                && !n.text.contains('\0')
                && !n.text.trim().is_empty(),
            "Invalid saved note"
        );
    }
    Ok(saved.notes)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn dir() -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "apparent-notes-{}",
            crate::shared::ids::make_bundle_id()
        ));
        std::fs::create_dir(&p).unwrap();
        p
    }
    #[test]
    fn accepted_escaped_notes_round_trip_at_full_capacity() {
        let directory = dir();
        let mut store = Store::new(&directory);
        for pin in 1..=MAX_NOTES as u32 {
            store.open(pin, u64::from(pin), 0.5, 0.5).unwrap();
            store.save(pin, "\u{1}".repeat(MAX_TEXT_BYTES)).unwrap();
        }
        assert_eq!(read(&directory).unwrap(), store.notes());
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn note_reader_rejects_fifo_without_waiting_for_a_writer() {
        use std::os::unix::ffi::OsStrExt;
        let directory = dir();
        let path =
            std::ffi::CString::new(directory.join("notes.json").as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(path.as_ptr(), 0o600) }, 0);
        assert!(
            read(&directory)
                .unwrap_err()
                .to_string()
                .contains("regular file")
        );
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn empty_and_dismissed_pins_do_not_exhaust_note_capacity() {
        let directory = dir();
        let mut store = Store::new(&directory);
        for pin in 1..=250 {
            store.open(pin, 1, 0.5, 0.5).unwrap();
            store.draft(pin, "abandoned".into()).unwrap();
            store.dismiss();
        }
        store.open(251, 1, 0.5, 0.5).unwrap();
        store.save(251, String::new()).unwrap();
        assert!(store.drafts().is_empty());
        assert!(read(&directory).unwrap().is_empty());
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn attached_notes_preserve_click_time_and_exclude_drafts() {
        let p = dir();
        let mut s = Store::new(&p);
        s.open(1, 125, 0.2, 0.3).unwrap();
        s.draft(1, "unsent".into()).unwrap();
        assert!(read(&p).unwrap().is_empty());
        s.save(1, " first \n second ".into()).unwrap();
        assert!(s.open(1, 900, 0.9, 0.9).is_err());
        s.save(1, "edited".into()).unwrap();
        assert_eq!(
            read(&p).unwrap(),
            vec![Note {
                pin: 1,
                t: 125,
                x: 0.2,
                y: 0.3,
                text: "first \n second".into()
            }]
        );
        s.open(2, 200, 0.3, 0.4).unwrap();
        s.save(2, "  ".into()).unwrap();
        assert_eq!(s.notes().len(), 1);
        assert!(s.drafts().is_empty());
        assert_eq!(read(&p).unwrap(), s.notes());
        std::fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn failed_note_save_keeps_draft_and_saved_count() {
        let p = dir();
        let mut s = Store::new(&p);
        s.open(1, 1, 0.2, 0.3).unwrap();
        std::fs::create_dir(p.join("notes.json")).unwrap();
        assert!(s.save(1, "keep this".into()).is_err());
        assert!(s.notes().is_empty());
        assert_eq!(s.drafts()[0].text, "keep this");
        std::fs::remove_dir_all(p).unwrap();
    }
}
