import Base

def admit_written_report(nonblank: Bool, safe: Bool, byte_count: Nat) -> Bool:
  Bool.and(Bool.and(nonblank, safe), Nat.is_le(byte_count, 8192n))
