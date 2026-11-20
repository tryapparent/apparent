import Base

def admit_words(has_words: Bool, needs_visuals: Bool) -> Bool:
  match has_words:
    case True{}:
      Bool.not(needs_visuals)
    case False{}:
      False{}

def transcript_only(enabled: Bool, has_words: Bool, needs_visuals: Bool) -> Bool:
  match enabled:
    case True{}:
      admit_words(has_words, needs_visuals)
    case False{}:
      False{}
