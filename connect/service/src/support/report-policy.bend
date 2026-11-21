import Base

def upload_limit(+extended: Bool) -> Nat:
  Bool.pick(Nat, extended, 33554432n, 25165824n)

def advertised_limit(+extended: Bool, +current_client: Bool) -> Nat:
  upload_limit(Bool.and(extended, current_client))

def upload_size(+extended: Bool, +bytes: Nat) -> Bool:
  Bool.and(Nat.is_le(64n, bytes), Nat.is_le(bytes, upload_limit(extended)))
