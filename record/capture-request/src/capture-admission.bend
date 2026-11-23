import Base

type StartDecision is Data:
  Existing{}
  Expired{}
  Occupied{}
  Begin{}

def admit_start(seen: Bool, expired: Bool, occupied: Bool) -> StartDecision:
  match seen:
    case True{}: Existing{}
    case False{}:
      Bool.pick(StartDecision, expired, Expired{}, Bool.pick(StartDecision, occupied, Occupied{}, Begin{}))

type Receipt is Data:
  Unknown{}
  Starting{}
  Recording{}
  Rejected{}
  Processing{}
  Saved{}
  CancelledReceipt{}
  Failed{}

def ended_for_stop(receipt: Receipt) -> Bool:
  match receipt:
    case Processing{}: True{}
    case Saved{}: True{}
    case CancelledReceipt{}: True{}
    case Failed{}: True{}
    case other: False{}

type Outcome is Data:
  DeadlinePassed{}
  AlreadyEnded{}
  WrongCapture{}
  NotReady{}
  Stopping{}
  Cancelled{}

def control_current(has_current: Bool, matches_current: Bool, ready: Bool, admitted: Outcome) -> Outcome:
  Bool.pick(Outcome, has_current, Bool.pick(Outcome, matches_current, Bool.pick(Outcome, ready, admitted, NotReady{}), WrongCapture{}), AlreadyEnded{})

def admit_control(expired: Bool, cancel: Bool, ended: Bool, has_current: Bool, matches_current: Bool, starting: Bool, recording: Bool) -> Outcome:
  match expired:
    case True{}: DeadlinePassed{}
    case False{}:
      match cancel:
        case True{}: control_current(has_current, matches_current, Bool.or(starting, recording), Cancelled{})
        case False{}: Bool.pick(Outcome, ended, AlreadyEnded{}, control_current(has_current, matches_current, recording, Stopping{}))
