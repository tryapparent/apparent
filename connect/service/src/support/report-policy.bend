import Base

def upload_size(+bytes: Nat) -> Bool:
  Bool.and(Nat.is_le(64n, bytes), Nat.is_le(bytes, 25165824n))
