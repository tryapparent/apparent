import Base

def family(+index: U32) -> U32:
  dog = Bool.and(U32.is_ge(index, 151), U32.is_le(index, 268))
  cat = Bool.and(U32.is_ge(index, 281), U32.is_le(index, 285))
  Bool.pick(U32, dog, 1, Bool.pick(U32, cat, 2, 0))

def category(+group: U32, combined: U32, top: U32, generic: Bool) -> U32:
  pooled = Bool.and(U32.is_gt(group, 0), U32.is_ge(combined, 750))
  specific = Bool.and(Bool.not(generic), U32.is_ge(top, 850))
  Bool.pick(U32, pooled, group, Bool.pick(U32, specific, 3, 0))

def word_admission(+hits: U32, confidence: U32, complete: Bool) -> U32:
  reliable = Bool.and(complete, Bool.and(U32.is_eq(hits, 9), U32.is_ge(confidence, 750)))
  Bool.pick(U32, U32.is_eq(hits, 0), 0, Bool.pick(U32, reliable, 2, 1))

def select_line(uncertain: Bool, centered_x: Bool, centered_y: Bool, has_category: Bool) -> Bool:
  Bool.and(Bool.not(uncertain), Bool.and(centered_x, Bool.or(centered_y, has_category)))

def retry_region(has_text: Bool, uncertain: Bool, has_category: Bool, wide: Bool) -> U32:
  retry = Bool.pick(U32, has_category, 2, Bool.pick(U32, wide, 1, 0))
  Bool.pick(U32, Bool.or(has_text, uncertain), 0, retry)

def include_caption(has_category: Bool, lines: U32) -> Bool:
  Bool.or(Bool.not(has_category), U32.is_eq(lines, 1))

law low_confidence_text_is_uncertain:
  {word_admission(9, 600, True{}) == 1 : U32}

def low_confidence_text_is_uncertain():
  {==}

law partial_text_is_uncertain:
  {word_admission(6, 990, True{}) == 1 : U32}

def partial_text_is_uncertain():
  {==}
