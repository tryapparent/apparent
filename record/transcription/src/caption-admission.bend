import Base

def preview_allowed(enabled: Bool, supported: Bool) -> Bool:
  match enabled:
    case True{}:
      supported
    case False{}:
      False{}
