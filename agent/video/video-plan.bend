import Base

def clip_valid(from: Nat, +to: Nat, duration: Nat) -> Bool:
  Bool.and(Nat.is_lt(from, to), Nat.is_le(to, duration))

def still_valid(at: Nat, duration: Nat) -> Bool:
  Nat.is_lt(at, duration)

def frames_for_ms(ms: Nat) -> Nat:
  Nat.div(Nat.add(Nat.mul(ms, 30n), 999n), 1000n)

def scene_frames(visual_ms: Nat, speech_frames: Nat, hold_ms: Nat) -> Nat:
  Nat.max(frames_for_ms(visual_ms), Nat.add(speech_frames, frames_for_ms(hold_ms)))

def caption_end(start: Nat, speech_ms: Nat) -> Nat:
  Nat.add(start, frames_for_ms(speech_ms))

def sample_time(from: Nat, span: Nat, index: Nat, count: Nat) -> Nat:
  Nat.add(from, Nat.div(Nat.mul(span, index), Nat.max(1n, Nat.sub(count, 1n))))

def axis_fits(start: Nat, +size: Nat, limit: Nat) -> Bool:
  Bool.and(Nat.is_lt(0n, size), Nat.is_le(Nat.add(start, size), limit))
