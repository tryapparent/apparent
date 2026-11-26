import Base

def threshold(item: U32) -> U32:
  match item:
    case 0:
      10
    case 1:
      30
    case 2:
      60
    case other:
      61

def adds_credit(enabled: Bool, eligible: Bool, duplicate: Bool, count: U32) -> Bool:
  match enabled:
    case False{}:
      False{}
    case True{}:
      match eligible:
        case False{}:
          False{}
        case True{}:
          match duplicate:
            case True{}:
              False{}
            case False{}:
              (count < threshold(2) : U32)

def award_if_earned(earned: Bool) -> U32:
  match earned:
    case True{}:
      2
    case False{}:
      0

def earned_state(item: U32, count: U32, state: U32) -> U32:
  match state:
    case 0:
      award_if_earned((threshold(item) <= count : U32))
    case other:
      state

def state_action(state: U32) -> U32:
  match state:
    case 1:
      1
    case 2:
      2
    case other:
      0

def available_action(item: U32, count: U32, state: U32) -> U32:
  state_action(earned_state(item, count, state))

def apply_if_equal(action: U32, expected: U32) -> U32:
  match action:
    case 1:
      match expected:
        case 1:
          2
        case other:
          0
    case 2:
      match expected:
        case 2:
          1
        case other:
          0
    case other:
      0

def apply_action(item: U32, count: U32, state: U32, action: U32) -> U32:
  apply_if_equal(action, available_action(item, count, state))
