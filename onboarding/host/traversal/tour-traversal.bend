import Base

type Step is Data:
  TourWelcome{}
  TourHowItWorks{}
  TourPermissions{}
  TourShortcut{}
  TourTryIt{}
  TourDone{}

type Primary is Data:
  TourStay{}
  TourAdvance{}
  TourClose{}

def permission_step(ready: Bool) -> Step:
  Bool.pick(Step, ready, TourShortcut{}, TourPermissions{})

def visible(step: Step, permissions_ready: Bool) -> Bool:
  match step:
    case TourHowItWorks{}:
      False{}
    case TourPermissions{}:
      Bool.not(permissions_ready)
    case other:
      True{}

def enter(step: Step, permissions_ready: Bool) -> Step:
  match step:
    case TourHowItWorks{}:
      permission_step(permissions_ready)
    case TourPermissions{}:
      permission_step(permissions_ready)
    case other:
      other

def next(step: Step, permissions_ready: Bool) -> Step:
  match step:
    case TourWelcome{}:
      permission_step(permissions_ready)
    case TourHowItWorks{}:
      permission_step(permissions_ready)
    case TourPermissions{}:
      TourShortcut{}
    case TourShortcut{}:
      TourTryIt{}
    case TourTryIt{}:
      TourDone{}
    case TourDone{}:
      TourDone{}

type Transition is Data:
  TourGo{step: Step}
  TourDismiss{}

def advance(step: Step, repair: Bool, permissions_ready: Bool) -> Transition:
  match repair:
    case True{}:
      TourDismiss{}
    case False{}:
      TourGo{next(step, permissions_ready)}

def previous(step: Step, permissions_ready: Bool) -> Step:
  match step:
    case TourShortcut{}:
      Bool.pick(Step, permissions_ready, TourWelcome{}, TourPermissions{})
    case TourTryIt{}:
      TourShortcut{}
    case TourDone{}:
      TourTryIt{}
    case other:
      TourWelcome{}

def back(step: Step, repair: Bool, permissions_ready: Bool) -> Step:
  match repair:
    case True{}:
      step
    case False{}:
      previous(step, permissions_ready)

def primary(step: Step, permissions_ready: Bool, practice: Bool, chosen: Bool, tested: Bool, editing: Bool) -> Primary:
  match step:
    case TourPermissions{}:
      Bool.pick(Primary, permissions_ready, TourAdvance{}, TourStay{})
    case TourShortcut{}:
      Bool.pick(Primary, Bool.or(Bool.not(practice), Bool.and(chosen, Bool.and(tested, Bool.not(editing)))), TourAdvance{}, TourStay{})
    case TourTryIt{}:
      Bool.pick(Primary, practice, TourStay{}, TourClose{})
    case TourDone{}:
      TourClose{}
    case other:
      TourAdvance{}

def practice_resume(step: Step, completed: Bool) -> Step:
  match step:
    case TourShortcut{}:
      Bool.pick(Step, completed, TourDone{}, TourShortcut{})
    case TourTryIt{}:
      Bool.pick(Step, completed, TourDone{}, TourTryIt{})
    case TourDone{}:
      Bool.pick(Step, completed, TourDone{}, TourTryIt{})
    case earlier:
      earlier

def resume_capture(step: Step, practice: Bool, completed: Bool) -> Step:
  match practice:
    case True{}:
      practice_resume(step, completed)
    case False{}:
      step

def practice_control(step: Step, recording: Bool, target_stage: Bool) -> Bool:
  match step:
    case TourTryIt{}:
      Bool.and(recording, target_stage)
    case other:
      False{}

law blocked_permission_cannot_advance:
  for practice: Bool
  for chosen: Bool
  for tested: Bool
  for editing: Bool
  {primary(TourPermissions{}, False{}, practice, chosen, tested, editing) == TourStay{} : Primary}

def blocked_permission_cannot_advance(practice, chosen, tested, editing):
  {==}

law back_keeps_repair_open:
  for +step: Step
  for permissions_ready: Bool
  {back(step, True{}, permissions_ready) == step : Step}

def back_keeps_repair_open(step, permissions_ready):
  {==}

def hide_practice_coach(practice: Bool, board_visible: Bool, board_step: Bool, preparing: Bool) -> Bool:
  Bool.and(practice, Bool.or(board_visible, Bool.or(board_step, preparing)))
