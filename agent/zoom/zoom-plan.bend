import Base

type Clock is Data:
  Clock{hi: Nat, lo: Nat}

type ZoomWindow is Data:
  ZoomWindow{start: Clock, stop: Clock}

def before(a: Clock, b: Clock) -> Bool:
  match a b:
    case Clock{+ah, al} Clock{+bh, bl}:
      Bool.or(Nat.is_lt(ah, bh), Bool.and(Nat.is_eq(ah, bh), Nat.is_lt(al, bl)))

def earlier(+a: Clock, +b: Clock) -> Clock:
  Bool.pick(Clock, before(a, b), a, b)

def later(+a: Clock, +b: Clock) -> Clock:
  Bool.pick(Clock, before(a, b), b, a)

def radix() -> Nat:
  Nat.add(4294967295n, 1n)

def packed(+hi: Nat, lo: Nat) -> Clock:
  Bool.pick(Clock, Nat.is_lt(hi, radix()), Clock{hi, lo}, Clock{4294967295n, 4294967295n})

def plus(a: Clock, b: Clock) -> Clock:
  match a b:
    case Clock{ah, al} Clock{bh, bl}:
      +total = Nat.add(al, bl)
      packed(Nat.add(Nat.add(ah, bh), Nat.div(total, radix())), Nat.mod(total, radix()))

def subtract(underflow: Bool, a: Clock, b: Clock) -> Clock:
  match underflow:
    case True{}: Clock{0n, 0n}
    case False{}:
      match a b:
        case Clock{ah, +al} Clock{bh, +bl}:
          +borrow = Bool.pick(Nat, Nat.is_lt(al, bl), 1n, 0n)
          Clock{Nat.sub(Nat.sub(ah, bh), borrow), Nat.sub(Nat.add(al, Nat.mul(borrow, radix())), bl)}

def minus(+a: Clock, +b: Clock) -> Clock:
  subtract(before(a, b), a, b)

def fraction(a: Clock, +n: Nat, +d: Nat) -> Clock:
  match a:
    case Clock{hi, lo}:
      +high = Nat.mul(hi, n)
      +low = Nat.div(Nat.add(Nat.mul(Nat.mod(high, d), radix()), Nat.mul(lo, n)), d)
      Clock{Nat.add(Nat.div(high, d), Nat.div(low, radix())), Nat.mod(low, radix())}

def zoom_window(+mark: Bool, +a: Clock, +b: Clock, +span: Clock, +duration: Clock) -> ZoomWindow:
  +width = earlier(duration, later(Clock{0n, 200n}, Bool.pick(Clock, mark, later(span, plus(minus(b, a), Clock{0n, 1000n})), span)))
  center = Bool.pick(Clock, mark, plus(earlier(a, b), fraction(minus(later(a, b), earlier(a, b)), 1n, 2n)), a)
  +start = earlier(minus(duration, width), minus(center, fraction(width, 1n, Bool.pick(Nat, mark, 2n, 4n))))
  ZoomWindow{start, plus(start, width)}

def low_word(t: Clock) -> Nat:
  match t:
    case Clock{high, low}: low

def cell_count(start: Clock, stop: Clock, requested: Clock) -> Nat:
  Bool.pick(Nat, before(start, stop), Nat.max(1n, low_word(earlier(requested, Clock{0n, 48n}))), 1n)

def cell_time(+start: Clock, stop: Clock, index: Nat, count: Nat) -> Clock:
  plus(start, fraction(minus(stop, start), index, Nat.max(1n, Nat.sub(count, 1n))))

def prefix(query: List<&2, String>, words: List<&2, String>, equal: Bool) -> Bool:
  match query words equal:
    case _ _ False{}: False{}
    case Nil{} _ True{}: True{}
    case token <> rest Nil{} True{}: False{}
    case token <> rest word <> tail True{}:
      prefix(rest, tail, String.eq(word, token))

def word_match(words: List<&2, String>, +query: List<&2, String>, +index: Nat, previous: Nat) -> Nat:
  match words previous:
    case _ 1n+found: Nat.add(found, 1n)
    case Nil{} 0n: 0n
    case head <> +tail 0n:
      word_match(tail, query, Nat.add(index, 1n), Bool.pick(Nat, prefix(query, head <> tail, True{}), index, 0n))

def segment_match(segments: List<&2, String>, +phrase: String, +index: Nat, previous: Nat) -> Nat:
  match segments previous:
    case _ 1n+found: Nat.add(found, 1n)
    case Nil{} 0n: 0n
    case segment <> tail 0n:
      segment_match(tail, phrase, Nat.add(index, 1n), Bool.pick(Nat, String.contains(segment, phrase), index, 0n))

type Hit is Data:
  Hit{word: Bool, index: Nat}

def fallback(missing: Bool, index: Nat, segments: List<&2, String>, phrase: String) -> Hit:
  match missing:
    case False{}: Hit{True{}, index}
    case True{}: Hit{False{}, segment_match(segments, phrase, 1n, 0n)}

def phrase_hit(words: List<&2, String>, segments: List<&2, String>, query: List<&2, String>, phrase: String) -> Hit:
  match query:
    case Nil{}: Hit{False{}, 0n}
    case +head <> tail:
      +index = word_match(words, head <> tail, 1n, 0n)
      fallback(Nat.is_eq(index, 0n), index, segments, phrase)

def nearest(rest: List<&2, Clock>, +time: Clock, +index: Nat, +winner: Nat, +distance: Clock) -> Nat:
  match rest:
    case Nil{}: winner
    case +head <> tail:
      +delta = minus(later(time, head), earlier(time, head))
      next = Bool.pick(Nat, before(delta, distance), index, winner)
      nearest(tail, time, Nat.add(index, 1n), next, earlier(distance, delta))

def nearest_cell(frames: List<&2, Clock>, +time: Clock) -> Nat:
  match frames:
    case Nil{}: 0n
    case +head <> tail:
      nearest(tail, time, 2n, 1n, minus(later(time, head), earlier(time, head)))
