use std::fs::{self, File};
use std::io::{Read, Seek};
use std::path::{Component, Path};

pub(super) struct OomSample {
    events: File,
    baseline: u64,
}

impl OomSample {
    pub(super) fn start(pid: u32) -> Option<Self> {
        let membership = fs::read_to_string(format!("/proc/{pid}/cgroup")).ok()?;
        let group = Path::new(
            membership
                .lines()
                .find_map(|line| line.strip_prefix("0::"))?,
        );
        let relative = group.strip_prefix("/").ok()?;
        if !relative
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
        {
            return None;
        }
        let mut events = File::open(
            Path::new("/sys/fs/cgroup")
                .join(relative)
                .join("memory.events.local"),
        )
        .ok()?;
        let baseline = count(&mut events)?;
        Some(Self { events, baseline })
    }

    pub(super) fn increased(mut self) -> Option<bool> {
        Some(count(&mut self.events)?.checked_sub(self.baseline)? > 0)
    }
}

fn count(file: &mut File) -> Option<u64> {
    file.rewind().ok()?;
    let mut counters = String::new();
    file.take(4097).read_to_string(&mut counters).ok()?;
    if counters.len() > 4096 {
        return None;
    }
    counters
        .lines()
        .find_map(|line| line.strip_prefix("oom_kill "))?
        .parse()
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn reads_the_pinned_local_counter_at_exit() {
        let mut file = tempfile::tempfile().unwrap();
        file.write_all(b"oom 9\noom_kill 13\noom_group_kill 1\n")
            .unwrap();
        assert_eq!(count(&mut file), Some(13));
        assert_eq!(
            OomSample {
                events: file.try_clone().unwrap(),
                baseline: 12
            }
            .increased(),
            Some(true)
        );
        assert_eq!(
            OomSample {
                events: file.try_clone().unwrap(),
                baseline: 13
            }
            .increased(),
            Some(false)
        );
        assert_eq!(
            OomSample {
                events: file,
                baseline: 14
            }
            .increased(),
            None
        );
    }
}
