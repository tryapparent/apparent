import Base

def lifetime() -> U32:
  120000

def can_poll(remaining: U32, attempts: U32) -> Bool:
  Bool.and((remaining > 0 : U32), (attempts < 24 : U32))

def interval(first: Bool, early: Bool, second: Bool) -> U32:
  match first early second:
    case True{} _ _: 0
    case False{} True{} _: 1000
    case False{} False{} True{}: 4000
    case False{} False{} False{}: 5000

def next_interval(+attempts: U32, foreground: Bool) -> U32:
  interval(U32.is_zero(attempts), Bool.or(foreground, U32.is_eq(attempts, 1)), U32.is_eq(attempts, 2))

def wait_until(remaining: U32, +since_last: U32, cadence: U32) -> U32:
  U32.min(remaining, (U32.max(since_last, cadence) - since_last : U32))

def wait_ms(remaining: U32, since_last: U32, attempts: U32, visible: Bool, foreground: Bool) -> U32:
  match visible:
    case False{}:
      remaining
    case True{}:
      wait_until(remaining, since_last, next_interval(attempts, foreground))
