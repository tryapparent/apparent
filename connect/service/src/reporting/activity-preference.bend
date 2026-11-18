import Base

def may_queue(gpc: Bool, dnt: Bool) -> Bool:
  match gpc:
    case True{}:
      False{}
    case False{}:
      match dnt:
        case True{}:
          False{}
        case False{}:
          True{}

law global_privacy_control_blocks_activity:
  for dnt: Bool
  {may_queue(True{}, dnt) == False{} : Bool}

def global_privacy_control_blocks_activity(dnt):
  {==}

law do_not_track_blocks_activity:
  for gpc: Bool
  {may_queue(gpc, True{}) == False{} : Bool}

def do_not_track_blocks_activity(gpc):
  match gpc:
    case True{}:
      {==}
    case False{}:
      {==}
