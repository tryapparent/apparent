import Base

def problem(+path_allowed: Bool, +listed: Bool) -> String:
  match path_allowed listed:
    case False{} _:
      "invalid_path"
    case True{} False{}:
      "not_found"
    case True{} True{}:
      ""
