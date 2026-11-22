import Base

def transcript_only(has_words: Bool, needs_visuals: Bool) -> Bool:
  match has_words:
    case True{}:
      Bool.not(needs_visuals)
    case False{}:
      False{}
