import Base

def family(+index: U32) -> U32:
  dog = Bool.and(U32.is_ge(index, 151), U32.is_le(index, 268))
  cat = Bool.and(U32.is_ge(index, 281), U32.is_le(index, 285))
  Bool.pick(U32, dog, 1, Bool.pick(U32, cat, 2, 0))

def category(+group: U32, combined: U32, top: U32, generic: Bool) -> U32:
  pooled = Bool.and(U32.is_gt(group, 0), U32.is_ge(combined, 750))
  specific = Bool.and(Bool.not(generic), U32.is_ge(top, 850))
  Bool.pick(U32, pooled, group, Bool.pick(U32, specific, 3, 0))

def word_admission(hits: U32, confidence: U32) -> U32:
  Bool.pick(U32, U32.is_ge(hits, 3), Bool.pick(U32, U32.is_ge(confidence, 750), 2, 1), 0)

def retry_region(has_text: Bool, has_category: Bool, wide: Bool) -> U32:
  match has_text:
    case True{}:
      0
    case False{}:
      match has_category:
        case True{}:
          2
        case False{}:
          Bool.pick(U32, wide, 1, 0)

def include_category(has_text: Bool, wide: Bool, lines: U32) -> Bool:
  Bool.or(Bool.not(has_text), Bool.and(Bool.not(wide), U32.is_eq(lines, 1)))

law low_confidence_text_is_uncertain:
  {word_admission(5, 600) == 1 : U32}

def low_confidence_text_is_uncertain():
  {==}
