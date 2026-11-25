import Base

def coverage(has_sample: Bool, has_control: Bool, bound: Bool) -> U32:
  match has_sample:
    case False{}:
      3
    case True{}:
      match has_control:
        case True{}:
          match bound:
            case True{}:
              0
            case False{}:
              1
        case False{}:
          match bound:
            case True{}:
              2
            case False{}:
              0

law a_visible_preference_needs_a_binding:
  {coverage(True{}, True{}, False{}) == 1 : U32}

def a_visible_preference_needs_a_binding():
  {==}

law every_preference_needs_a_sample:
  {coverage(False{}, True{}, True{}) == 3 : U32}

def every_preference_needs_a_sample():
  {==}
