import Base

def available(+requested: Bool, +ready: Bool, +encrypted: Bool) -> Bool:
  Bool.and(requested, Bool.and(ready, encrypted))

def scan_limit() -> U32:
  12

def token_budget() -> U32:
  1024
