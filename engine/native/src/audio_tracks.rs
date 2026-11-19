use crate::output::Result;
use std::{collections::BTreeSet, fs::File, os::unix::fs::FileExt};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RawFormats {
    float32: Option<&'static str>,
    float64: Option<&'static str>,
}
impl RawFormats {
    fn declare(&mut self, width: u32, little: bool) -> Result<()> {
        let (slot, format) = match (width, little) {
            (32, true) => (&mut self.float32, "F32LE"),
            (32, false) => (&mut self.float32, "F32BE"),
            (64, true) => (&mut self.float64, "F64LE"),
            (64, false) => (&mut self.float64, "F64BE"),
            _ => return Err("decode_failed"),
        };
        if slot.is_some_and(|prior| prior != format) {
            return Err("decode_failed");
        }
        *slot = Some(format);
        Ok(())
    }
    pub fn expected(&self, actual: &str) -> Option<&'static str> {
        match actual {
            "F32BE" | "F32LE" => self.float32,
            "F64BE" | "F64LE" => self.float64,
            _ => None,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Track {
    pub id: u32,
    pub formats: RawFormats,
    pub uncompressed_headers: Vec<u64>,
}

#[derive(Clone, Copy)]
struct Atom {
    kind: [u8; 4],
    body: u64,
    end: u64,
}
struct Movie<'a> {
    file: &'a File,
    remaining: usize,
}
impl Movie<'_> {
    fn bytes<const N: usize>(&self, at: u64, end: u64) -> Result<[u8; N]> {
        if at.checked_add(N as u64).is_none_or(|last| last > end) {
            return Err("decode_failed");
        }
        let mut bytes = [0; N];
        self.file
            .read_exact_at(&mut bytes, at)
            .map_err(|_| "decode_failed")?;
        Ok(bytes)
    }
    fn children(&mut self, mut at: u64, end: u64) -> Result<Vec<Atom>> {
        if at > end {
            return Err("decode_failed");
        }
        let mut atoms = Vec::new();
        while at < end {
            if self.remaining == 0 {
                return Err("resource_limit");
            }
            self.remaining -= 1;
            let header = self.bytes::<8>(at, end)?;
            let length = u32::from_be_bytes(header[..4].try_into().unwrap());
            let (size, header_size) = match length {
                0 => (end - at, 8),
                1 => (u64::from_be_bytes(self.bytes::<8>(at + 8, end)?), 16),
                size => (u64::from(size), 8),
            };
            let last = at.checked_add(size).ok_or("decode_failed")?;
            if size < header_size || last > end {
                return Err("decode_failed");
            }
            atoms.push(Atom {
                kind: header[4..].try_into().unwrap(),
                body: at + header_size,
                end: last,
            });
            at = last;
        }
        Ok(atoms)
    }
    fn only(atoms: &[Atom], kind: &[u8; 4]) -> Result<Atom> {
        Self::optional(atoms, kind)?.ok_or("decode_failed")
    }
    fn optional(atoms: &[Atom], kind: &[u8; 4]) -> Result<Option<Atom>> {
        let mut found = atoms.iter().filter(|atom| &atom.kind == kind);
        let atom = found.next().copied();
        if found.next().is_some() {
            return Err("decode_failed");
        }
        Ok(atom)
    }
    fn formats(&mut self, media: &[Atom]) -> Result<(RawFormats, Vec<u64>)> {
        let mut result = RawFormats::default();
        let mut headers = Vec::new();
        let Some(minf) = Self::optional(media, b"minf")? else {
            return Ok((result, headers));
        };
        let children = self.children(minf.body, minf.end)?;
        let Some(stbl) = Self::optional(&children, b"stbl")? else {
            return Ok((result, headers));
        };
        let children = self.children(stbl.body, stbl.end)?;
        let Some(stsd) = Self::optional(&children, b"stsd")? else {
            return Ok((result, headers));
        };
        let count = u32::from_be_bytes(self.bytes::<4>(stsd.body + 4, stsd.end)?);
        let entries = self.children(stsd.body + 8, stsd.end)?;
        if count as usize != entries.len() {
            return Err("decode_failed");
        }
        for entry in entries {
            if entry.kind == *b"lpcm" {
                let version = u16::from_be_bytes(self.bytes::<2>(entry.body + 8, entry.end)?);
                if version != 2 {
                    return Err("decode_failed");
                }
                if u16::from_be_bytes(self.bytes::<2>(entry.body + 20, entry.end)?) == 0xfffe {
                    headers.push(entry.body + 20);
                }
                let channels = u32::from_be_bytes(self.bytes::<4>(entry.body + 40, entry.end)?);
                let bits = u32::from_be_bytes(self.bytes::<4>(entry.body + 48, entry.end)?);
                let flags = u32::from_be_bytes(self.bytes::<4>(entry.body + 52, entry.end)?);
                let packet = u32::from_be_bytes(self.bytes::<4>(entry.body + 56, entry.end)?);
                if flags & 1 != 0 {
                    if channels == 0 {
                        return Err("decode_failed");
                    }
                    let width = u64::from(packet) * 8 / u64::from(channels);
                    if width != u64::from(bits) {
                        return Err("decode_failed");
                    }
                    result.declare(bits, flags & 2 == 0)?;
                }
                continue;
            }
            if entry.kind != *b"fl32" && entry.kind != *b"fl64" {
                continue;
            }
            let version = u16::from_be_bytes(self.bytes::<2>(entry.body + 8, entry.end)?);
            let skip = match version {
                0 => 28,
                1 => 44,
                2 => 64,
                _ => return Err("decode_failed"),
            };
            let mut extensions = self.children(entry.body + skip, entry.end)?;
            if let Some(wave) = Self::optional(&extensions, b"wave")? {
                extensions.extend(self.children(wave.body, wave.end)?);
            }
            let mut declared = None;
            for enda in extensions.iter().filter(|atom| &atom.kind == b"enda") {
                let little = match u16::from_be_bytes(self.bytes::<2>(enda.body, enda.end)?) {
                    0 => false,
                    1 => true,
                    _ => return Err("decode_failed"),
                };
                if declared.is_some_and(|prior| prior != little) {
                    return Err("decode_failed");
                }
                declared = Some(little);
            }
            let little = declared.unwrap_or(false);
            result.declare(if entry.kind == *b"fl32" { 32 } else { 64 }, little)?;
        }
        Ok((result, headers))
    }
}

pub fn selected(file: &File, indices: &[u32]) -> Result<Vec<Track>> {
    let mut movie = Movie {
        file,
        remaining: 65536,
    };
    let top = movie.children(0, file.metadata().map_err(|_| "decode_failed")?.len())?;
    let moov = Movie::only(&top, b"moov")?;
    let atoms = movie.children(moov.body, moov.end)?;
    let mut tracks = Vec::new();
    let mut seen = BTreeSet::new();
    for trak in atoms.iter().filter(|atom| &atom.kind == b"trak") {
        let fields = movie.children(trak.body, trak.end)?;
        let header = Movie::only(&fields, b"tkhd")?;
        let version = movie.bytes::<1>(header.body, header.end)?[0];
        let offset = match version {
            0 => 12,
            1 => 20,
            _ => return Err("decode_failed"),
        };
        let id = u32::from_be_bytes(movie.bytes::<4>(header.body + offset, header.end)?);
        if id == 0 || !seen.insert(id) {
            return Err("decode_failed");
        }
        let media = Movie::only(&fields, b"mdia")?;
        let media_fields = movie.children(media.body, media.end)?;
        let handler = Movie::only(&media_fields, b"hdlr")?;
        let audio = movie.bytes::<4>(handler.body + 8, handler.end)? == *b"soun";
        tracks.push((id, audio, media_fields));
    }
    indices
        .iter()
        .map(|&index| {
            let (id, audio, media) = tracks.get(index as usize).ok_or("decode_failed")?;
            if !*audio {
                return Err("decode_failed");
            }
            let (formats, uncompressed_headers) = movie.formats(media)?;
            Ok(Track {
                id: *id,
                formats,
                uncompressed_headers,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    fn atom(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut bytes = ((8 + body.len()) as u32).to_be_bytes().to_vec();
        bytes.extend(kind);
        bytes.extend(body);
        bytes
    }
    fn track(id: u32, handler: &[u8; 4], version: u8) -> Vec<u8> {
        let mut header = vec![0; if version == 1 { 24 } else { 16 }];
        header[0] = version;
        let length = header.len();
        header[length - 4..].copy_from_slice(&id.to_be_bytes());
        let mut media = vec![0; 8];
        media.extend(handler);
        let mut fields = atom(b"tkhd", &header);
        fields.extend(atom(b"mdia", &atom(b"hdlr", &media)));
        atom(b"trak", &fields)
    }
    fn read(bytes: &[u8], indices: &[u32]) -> Result<Vec<u32>> {
        use std::{
            os::unix::fs::OpenOptionsExt,
            sync::atomic::{AtomicU64, Ordering},
        };
        static ID: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "audio-track-{}-{}",
            std::process::id(),
            ID.fetch_add(1, Ordering::Relaxed)
        ));
        let mut file = std::fs::OpenOptions::new()
            .create_new(true)
            .read(true)
            .write(true)
            .mode(0o600)
            .open(&path)
            .unwrap();
        std::fs::remove_file(path).unwrap();
        file.write_all(bytes).unwrap();
        selected(&file, indices).map(|tracks| tracks.into_iter().map(|track| track.id).collect())
    }
    #[test]
    fn index_binding_uses_container_order_and_checks_handler_and_identity() {
        let mut tracks = track(20, b"vide", 0);
        tracks.extend(track(9, b"soun", 1));
        tracks.extend(track(2, b"soun", 0));
        let movie = atom(b"moov", &tracks);
        assert_eq!(read(&movie, &[2, 1]), Ok(vec![2, 9]));
        assert!(read(&movie, &[0]).is_err());
        assert!(read(&movie, &[3]).is_err());
        tracks.extend(track(2, b"soun", 0));
        assert!(read(&atom(b"moov", &tracks), &[1]).is_err());
        assert!(read(&atom(b"moov", &track(0, b"soun", 0)), &[0]).is_err());
    }
    #[test]
    fn malformed_and_ambiguous_box_boundaries_are_refused() {
        let good = atom(b"moov", &track(1, b"soun", 0));
        for size in 0..good.len() {
            assert!(read(&good[..size], &[0]).is_err());
        }
        let mut duplicate = good.clone();
        duplicate.extend(&good);
        assert!(read(&duplicate, &[0]).is_err());
        for length in [1, 7, u32::MAX] {
            let mut broken = good.clone();
            broken[..4].copy_from_slice(&length.to_be_bytes());
            assert!(read(&broken, &[0]).is_err());
        }
    }
}
