import Base

def threshold(item: U32) -> U32:
  match item:
    case 0:
      10
    case 1:
      20
    case 2:
      30
    case other:
      31

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
              (count < 30 : U32)

def item_action(unlocked: Bool, state: U32) -> U32:
  match unlocked:
    case False{}:
      0
    case True{}:
      match state:
        case 0:
          1
        case 1:
          2
        case 2:
          3
        case other:
          0

def available_action(item: U32, count: U32, state: U32) -> U32:
  match item:
    case 0:
      item_action((threshold(0) <= count : U32), state)
    case 1:
      item_action((threshold(1) <= count : U32), state)
    case 2:
      item_action((threshold(2) <= count : U32), state)
    case other:
      0

def apply_if_equal(action: U32, expected: U32) -> U32:
  match action:
    case 1:
      match expected:
        case 1:
          1
        case other:
          0
    case 2:
      match expected:
        case 2:
          2
        case other:
          0
    case 3:
      match expected:
        case 3:
          1
        case other:
          0
    case other:
      0

def apply_action(item: U32, count: U32, state: U32, action: U32) -> U32:
  apply_if_equal(action, available_action(item, count, state))
