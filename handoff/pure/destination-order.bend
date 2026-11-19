import Base

type Stamp is Data:
  Stamp{hi: U32, lo: U32}

type Runtime is Data:
  Idle{}
  Busy{}
  Failed{}
  Other{}

type Placement is Data:
  Placement{snooze: Stamp, snoozed_at: Stamp, settled: Bool, pinned: Bool, pin_key: Bool}

type Attention is Data:
  Attention{approval: Bool, question: Bool, question_at: Stamp, subagent: Bool, guest: Bool, plan: Bool}

type Activity is Data:
  Activity{
    runtime: Runtime, background: Bool, runtime_at: Stamp, stopped_plan: Bool, created: Stamp, unsettled: Stamp,
    requested: Stamp, started: Stamp, completed: Stamp, authored_available: Bool, authored: Stamp,
    latest_user: Stamp, updated: Stamp, settled_at: Stamp
  }

type Rank is Data:
  Rank{shelf: U32, tier: U32, stamp: Stamp}

def before(a: Stamp, b: Stamp) -> Bool:
  match a b:
    case Stamp{+ah, al} Stamp{+bh, bl}:
      Bool.or(U32.is_lt(ah, bh), Bool.and(U32.is_eq(ah, bh), U32.is_lt(al, bl)))

def later(+a: Stamp, +b: Stamp) -> Stamp:
  Bool.pick(Stamp, before(a, b), b, a)

def missing(a: Stamp) -> Bool:
  match a:
    case Stamp{hi, lo}:
      Bool.and(U32.is_eq(hi, 0), U32.is_eq(lo, 0))

def fallback(+a: Stamp, b: Stamp) -> Stamp:
  Bool.pick(Stamp, missing(a), b, a)

def newest(shelf: U32, tier: U32, stamp: Stamp) -> Rank:
  match stamp:
    case Stamp{hi, lo}:
      Rank{shelf, tier, Stamp{U32.sub(4294967295, hi), U32.sub(4294967295, lo)}}

def working(blocked: Bool, runtime: Runtime) -> Bool:
  match blocked runtime:
    case True{} _:
      False{}
    case False{} Idle{}:
      True{}
    case False{} Busy{}:
      True{}
    case False{} _:
      False{}

def fresh(+edge: Stamp, +since: Stamp) -> Bool:
  Bool.or(missing(since), Bool.or(missing(edge), before(since, edge)))

def fresh_failure(runtime: Runtime, +edge: Stamp, +since: Stamp) -> Bool:
  match runtime:
    case Failed{}:
      Bool.or(missing(since), before(since, edge))
    case _:
      False{}

def held_runtime(background: Bool, runtime: Runtime) -> Runtime:
  match background runtime:
    case True{} Failed{}:
      Failed{}
    case True{} _:
      Idle{}
    case False{} status:
      status

def rank(snoozed: Bool, settled: Bool, pinned: Bool, pin_key: Bool, busy: Bool, wake: Stamp, created: Stamp, returned: Stamp, sent: Stamp, ended: Stamp) -> Rank:
  match snoozed settled pinned pin_key busy:
    case True{} _ _ _ _:
      Rank{3, 0, wake}
    case False{} True{} _ _ _:
      newest(4, 0, ended)
    case False{} False{} True{} True{} _:
      Rank{0, 0, Stamp{0, 0}}
    case False{} False{} True{} False{} _:
      newest(0, 1, created)
    case False{} False{} False{} _ True{}:
      newest(2, 0, later(created, sent))
    case False{} False{} False{} _ False{}:
      newest(1, 0, later(created, returned))

def destination_rank(now: Stamp, placement: Placement, attention: Attention, activity: Activity) -> Rank:
  match placement attention activity:
    case Placement{+wake, +snoozed_at, settled, pinned, pin_key}
         Attention{+approval, +question, question_at, +subagent, guest, plan}
         Activity{status, background, runtime_at, stopped_plan, +created, unsettled, +requested, started, +completed, authored_available, authored, latest_user, updated, settled_at}:
      +runtime = held_runtime(background, status)
      raised = Bool.or(Bool.or(approval, subagent), Bool.or(guest, Bool.and(question, fresh(question_at, snoozed_at))))
      snoozed = Bool.and(before(now, wake), Bool.not(Bool.or(raised, fresh_failure(runtime, runtime_at, snoozed_at))))
      blocked = Bool.or(Bool.or(approval, question), Bool.or(subagent, Bool.and(plan, stopped_plan)))
      returned = later(unsettled, later(requested, completed))
      sent = Bool.pick(Stamp, authored_available, authored, requested)
      ended = fallback(settled_at, fallback(later(latest_user, later(requested, later(started, completed))), updated))
      rank(snoozed, settled, pinned, pin_key, working(blocked, runtime), wake, created, returned, sent, ended)

def inbox_done(shelf: U32, completed: Bool) -> Bool:
  Bool.and(U32.is_eq(shelf, 1), completed)

def reuse_destination(same_destination: Bool, is_new: Bool) -> Bool:
  Bool.and(same_destination, Bool.not(is_new))
