import Base

type Clock is Data:
  Clock{hi: U32, lo: U32}

type Span is Data:
  Span{start: Clock, end: Clock}

def before(a: Clock, b: Clock) -> Bool:
  match a b:
    case Clock{+ah, al} Clock{+bh, bl}:
      Bool.or(U32.is_lt(ah, bh), Bool.and(U32.is_eq(ah, bh), U32.is_lt(al, bl)))

def earlier(+a: Clock, +b: Clock) -> Clock:
  Bool.pick(Clock, before(a, b), a, b)

def later(+a: Clock, +b: Clock) -> Clock:
  Bool.pick(Clock, before(a, b), b, a)

def add_high(hi: U32, lo: U32, saturated: Bool) -> Clock:
  match saturated:
    case True{}:
      Clock{4294967295, 4294967295}
    case False{}:
      Clock{U32.add(hi, 1), lo}

def add_carry(+hi: U32, lo: U32, carry: Bool) -> Clock:
  match carry:
    case False{}:
      Clock{hi, lo}
    case True{}:
      add_high(hi, lo, U32.is_eq(hi, 4294967295))

def add_ms(a: Clock, +b: U32) -> Clock:
  match a:
    case Clock{hi, +lo}:
      add_carry(hi, U32.add(lo, b), U32.is_lt(U32.add(lo, b), lo))

def subtract_ordered(underflow: Bool, a: Clock, b: Clock) -> Clock:
  match underflow:
    case True{}:
      Clock{0, 0}
    case False{}:
      match a b:
        case Clock{ah, +al} Clock{bh, +bl}:
          Clock{
            U32.sub(U32.sub(ah, bh), Bool.pick(U32, U32.is_lt(al, bl), 1, 0)),
            U32.sub(al, bl)
          }

def difference(+a: Clock, +b: Clock) -> Clock:
  subtract_ordered(before(a, b), a, b)

def protect(timeline: Span, +offset: Clock) -> Span:
  match timeline:
    case Span{a, b}:
      Span{difference(difference(a, offset), Clock{0, 2000}), add_ms(difference(b, offset), 5000)}

def intersection(frozen: Span, silent: Span) -> Span:
  match frozen silent:
    case Span{a, b} Span{c, d}:
      Span{add_ms(later(a, c), 5000), difference(earlier(b, d), Clock{0, 5000})}

def starts_before(a: Span, b: Span) -> Bool:
  match a b:
    case Span{start, ae} Span{other, be}:
      before(start, other)

def at_front(a: Span, rest: List<&2, Span>) -> Bool:
  match rest:
    case Nil{}:
      True{}
    case head <> tail:
      starts_before(a, head)

def insert(limit: Nat, first: Bool, rest: List<&2, Span>, +item: Span) -> List<&2, Span>:
  match limit:
    case 0n:
      []
    case 1n+remaining:
      match first:
        case True{}:
          item <> List.take(&2, Span, rest, remaining)
        case False{}:
          match rest:
            case Nil{}:
              [item]
            case head <> +tail:
              head <> insert(remaining, at_front(item, tail), tail, item)

def long_enough(span: Span) -> Bool:
  match span:
    case Span{a, b}:
      Bool.not(before(difference(b, a), Clock{0, 10000}))

def retain_or_split(+x: Clock, +y: Clock, p: Clock, q: Clock, overlap: Bool) -> List<&2, Span>:
  match overlap:
    case False{}:
      [Span{x, y}]
    case True{}:
      [Span{x, later(p, x)}, Span{earlier(q, y), y}]

def split_piece(span: Span, protected: Span) -> List<&2, Span>:
  match span protected:
    case Span{+x, +y} Span{+p, +q}:
      retain_or_split(x, y, p, q, Bool.and(before(p, y), before(x, q)))

def split_all(spans: List<&2, Span>, +p: Span, out: List<&2, Span>) -> List<&2, Span>:
  match spans:
    case Nil{}:
      List.reverse(&2, Span, out)
    case head <> tail:
      split_all(tail, p, List.reverse.go(&2, Span, split_piece(head, p), out))

def add_qualified(enough: Bool, +head: Span, +out: List<&2, Span>, limit: Nat) -> List<&2, Span>:
  match enough:
    case False{}:
      out
    case True{}:
      insert(limit, at_front(head, out), out, head)

def filter_length(spans: List<&2, Span>, out: List<&2, Span>, +limit: Nat) -> List<&2, Span>:
  match spans:
    case Nil{}:
      out
    case +head <> tail:
      filter_length(tail, add_qualified(long_enough(head), head, out, limit), limit)

def filter_protected(protected: List<&2, Span>, spans: List<&2, Span>) -> List<&2, Span>:
  match protected:
    case Nil{}:
      spans
    case p <> tail:
      filter_protected(tail, split_all(spans, p, []))

def scan_silent(+frozen: Span, silent: List<&2, Span>, +protected: List<&2, Span>, +limit: Nat, out: List<&2, Span>) -> List<&2, Span>:
  match silent:
    case Nil{}:
      out
    case s <> tail:
      scan_silent(frozen, tail, protected, limit,
        filter_length(filter_protected(protected, [intersection(frozen, s)]), out, limit))

def scan_frozen(frozen: List<&2, Span>, +silent: List<&2, Span>, +protected: List<&2, Span>, +limit: Nat, out: List<&2, Span>) -> List<&2, Span>:
  match frozen:
    case Nil{}:
      out
    case f <> tail:
      scan_frozen(tail, silent, protected, limit, scan_silent(f, silent, protected, limit, out))

def protections(timeline: List<&2, Span>, +offset: Clock, out: List<&2, Span>) -> List<&2, Span>:
  match timeline:
    case Nil{}:
      List.reverse(&2, Span, out)
    case head <> tail:
      protections(tail, offset, protect(head, offset) <> out)

def plan_quiet_export(frozen: List<&2, Span>, silent: List<&2, Span>, timeline: List<&2, Span>, offset: Clock, limit: Nat) -> List<&2, Span>:
  scan_frozen(frozen, silent, protections(timeline, offset, []), limit, [])

type Parameters is Data:
  Parameters{freeze_db_magnitude: U32, freeze_ms: U32, silence_db_magnitude: U32, silence_ms: U32}

def quiet_parameters(unit: Unit) -> Parameters:
  Parameters{60, 12000, 55, 1000}

def quiet_rate(unit: Unit) -> U32:
  4

def limits_valid(+limit: U32, rate: U32) -> Bool:
  Bool.and(Bool.and(U32.is_ge(limit, 1), U32.is_le(limit, 64)), U32.is_eq(rate, quiet_rate(Unit{})))

def observations_valid(spans: List<&2, Span>, +duration: Clock, valid: Bool) -> Bool:
  match spans:
    case Nil{}:
      valid
    case Span{a, b} <> tail:
      observations_valid(tail, duration, Bool.and(valid, Bool.not(before(duration, b))))
