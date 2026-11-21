import Base

type Mode is Data:
  Area{}
  Screen{}
  Iphone{}
  Window{}

type Copy is Data:
  Ordinary{}
  Offline{}
  Uploading{}
  UploadStopped{}
  ShareReceipt{}

type Completion is Data:
  Result{dismiss_at: U32, recovery: Bool, sharing: Bool, consent: Bool, copy: Copy}

type Reveal is Data:
  Closed{}
  Open{min_at: U32, idle_at: U32, leave_at: U32, hovered: Bool, working: Bool, baseline: U32}

type Phase is Data:
  Hidden{}
  Selecting{mode: Mode}
  Recording{reveal: Reveal}
  Processing{released: Bool}
  Completed{result: Completion}
  Dismissing{}

type PillEvent is Data:
  PickerOpened{mode: Mode}
  ModeSelected{mode: Mode}
  CaptureStarted{}
  CaptureSealed{}
  SourceReleased{}
  CaptureSaved{recovery: Bool}
  CaptureFailed{}
  Dismiss{}
  SurfaceHidden{}
  Hide{}
  RevealOpened{activity: U32}
  RevealClosed{}
  PointerChanged{inside: Bool}
  ActivityObserved{activity: U32}
  ShareStarted{}
  ShareEnded{renew: Bool}
  ConsentChanged{open: Bool}
  CompletionText{copy: Copy}
  OnlineObserved{}
  Deadline{}

type Deadline is Data:
  NoDeadline{}
  WakeAt{time: U32}

def dismiss_after(now: U32) -> U32:
  U32.add(now, 15000)

def reached(now: U32, at: U32) -> Bool:
  U32.is_lt(U32.sub(now, at), 2147483648)

def later(+now: U32, +first: U32, +second: U32) -> U32:
  Bool.pick(U32, U32.is_lt(U32.sub(first, now), U32.sub(second, now)), second, first)

def pending(+now: U32, +at: U32) -> U32:
  Bool.pick(U32, reached(now, at), now, at)

def reveal_deadline(reveal: Reveal, +now: U32) -> Deadline:
  match reveal:
    case Closed{}:
      NoDeadline{}
    case Open{min_at, idle_at, leave_at, hovered, working, baseline}:
      base = Bool.pick(U32, working, min_at, idle_at)
      due = later(now, pending(now, base), pending(now, leave_at))
      Bool.pick(Deadline, hovered, NoDeadline{}, WakeAt{due})

def completion_deadline(result: Completion) -> Deadline:
  match result:
    case Result{dismiss_at, recovery, +sharing, consent, copy}:
      Bool.pick(Deadline, Bool.or(recovery, Bool.or(sharing, consent)), NoDeadline{}, WakeAt{dismiss_at})

def deadline(phase: Phase, now: U32) -> Deadline:
  match phase:
    case Recording{reveal}:
      reveal_deadline(reveal, now)
    case Completed{result}:
      completion_deadline(result)
    case other:
      NoDeadline{}

def expire(phase: Phase) -> Phase:
  match phase:
    case Recording{reveal}:
      Recording{Closed{}}
    case Completed{result}:
      Dismissing{}
    case other:
      other

def expire_if_due(+phase: Phase, now: U32, due: Deadline) -> Phase:
  match due:
    case NoDeadline{}:
      phase
    case WakeAt{time}:
      Bool.pick(Phase, reached(now, time), expire(phase), phase)

def apply_deadline(+phase: Phase, +now: U32) -> Phase:
  expire_if_due(phase, now, deadline(phase, now))

def pointer_changed(reveal: Reveal, +inside: Bool, +now: U32) -> Phase:
  match reveal:
    case Closed{}:
      Recording{Closed{}}
    case Open{min_at, idle_at, +leave_at, hovered, working, baseline}:
      next_leave = Bool.pick(U32, Bool.and(hovered, Bool.not(inside)), U32.add(now, 1200), leave_at)
      apply_deadline(Recording{Open{min_at, idle_at, next_leave, inside, working, baseline}}, now)

def work_started(reveal: Reveal, activity: U32, +now: U32) -> Phase:
  match reveal:
    case Closed{}:
      Recording{Closed{}}
    case Open{min_at, idle_at, leave_at, hovered, working, +baseline}:
      apply_deadline(Recording{Open{min_at, idle_at, leave_at, hovered, U32.is_gt(activity, baseline), baseline}}, now)

def recording_event(event: PillEvent, reveal: Reveal, +now: U32) -> Phase:
  match event:
    case CaptureSealed{}:
      Processing{False{}}
    case RevealOpened{activity}:
      Recording{Open{U32.add(now, 900), U32.add(now, 3500), now, False{}, False{}, activity}}
    case RevealClosed{}:
      Recording{Closed{}}
    case PointerChanged{inside}:
      pointer_changed(reveal, inside, now)
    case ActivityObserved{activity}:
      work_started(reveal, activity, now)
    case other:
      Recording{reveal}

def share_ended(result: Completion, renew: Bool, now: U32) -> Phase:
  match result:
    case Result{dismiss_at, recovery, sharing, consent, copy}:
      at = Bool.pick(U32, Bool.and(sharing, renew), dismiss_after(now), dismiss_at)
      Completed{Result{at, recovery, False{}, consent, copy}}

def online_copy(copy: Copy) -> Copy:
  match copy:
    case Offline{}:
      Ordinary{}
    case other:
      other

def completed_event(result: Completion, event: PillEvent, now: U32) -> Phase:
  match result:
    case Result{dismiss_at, recovery, +sharing, consent, copy}:
      match event:
        case ShareStarted{}:
          Completed{Result{Bool.pick(U32, consent, dismiss_after(now), dismiss_at), recovery, True{}, False{}, Ordinary{}}}
        case ShareEnded{renew}:
          share_ended(result, renew, now)
        case ConsentChanged{+open}:
          released = Bool.and(consent, Bool.not(open))
          at = Bool.pick(U32, released, dismiss_after(now), dismiss_at)
          Completed{Result{at, recovery, sharing, Bool.and(open, Bool.not(sharing)), copy}}
        case CompletionText{next_copy}:
          Completed{Result{dismiss_at, recovery, sharing, consent, next_copy}}
        case OnlineObserved{}:
          Completed{Result{dismiss_at, recovery, sharing, consent, online_copy(copy)}}
        case other:
          Completed{result}

def phase_event(phase: Phase, event: PillEvent, now: U32) -> Phase:
  match phase:
    case Selecting{mode}:
      match event:
        case ModeSelected{selected}:
          Selecting{selected}
        case other:
          phase
    case Recording{reveal}:
      recording_event(event, reveal, now)
    case Processing{released}:
      match event:
        case SourceReleased{}:
          Processing{True{}}
        case CaptureSaved{recovery}:
          Completed{Result{dismiss_after(now), recovery, False{}, False{}, Ordinary{}}}
        case other:
          phase
    case Completed{result}:
      completed_event(result, event, now)
    case Dismissing{}:
      match event:
        case SurfaceHidden{}:
          Hidden{}
        case other:
          phase
    case Hidden{}:
      phase

def idle_event(phase: Phase, requested: Phase) -> Phase:
  match phase:
    case Recording{reveal}:
      phase
    case Processing{released}:
      Bool.pick(Phase, released, requested, Processing{False{}})
    case other:
      requested

def step(event: PillEvent, phase: Phase, now: U32) -> Phase:
  match event:
    case Deadline{}:
      apply_deadline(phase, now)
    case Hide{}:
      Hidden{}
    case Dismiss{}:
      match phase:
        case Hidden{}:
          phase
        case other:
          Dismissing{}
    case CaptureFailed{}:
      match phase:
        case Hidden{}:
          phase
        case other:
          Dismissing{}
    case PickerOpened{mode}:
      idle_event(phase, Selecting{mode})
    case CaptureStarted{}:
      match phase:
        case Processing{released}:
          Bool.pick(Phase, released, Recording{Closed{}}, Processing{False{}})
        case other:
          Recording{Closed{}}
    case other:
      phase_event(phase, other, now)

law stale_surface_cannot_hide_a_recording:
  for +reveal: Reveal
  for now: U32
  {step(SurfaceHidden{}, Recording{reveal}, now) == Recording{reveal} : Phase}

def stale_surface_cannot_hide_a_recording(reveal, now):
  {==}

type Share is Data:
  NoShare{}
  ShareDisabled{}
  ShareAvailable{}
  ShareRetry{enabled: Bool}
  ShareUploading{}

type Surface is Data:
  HiddenSurface{}
  PickerSurface{mode: Mode, can_record: Bool, phone: Bool}
  RecordingSurface{switches: Bool, no_words: Bool, phone: Bool, notes: U32, movable: Bool, finish_primary: Bool}
  ProcessingSurface{}
  CompletedSurface{paste: Bool, inspect: Bool, share: Share, copy: Copy, audio_problem: Bool}

type Facts is Data:
  Facts{phone: Bool, no_words: Bool, note_count: U32, movable: Bool, paste: Bool, inspect: Bool, sharing_enabled: Bool, sharing_online: Bool, microphone_problem: Bool, audio_problem: Bool}

def share_control(enabled: Bool, uploading: Bool, retry: Bool, available: Bool) -> Share:
  match enabled:
    case False{}:
      NoShare{}
    case True{}:
      match uploading:
        case True{}:
          ShareUploading{}
        case False{}:
          match retry:
            case True{}:
              ShareRetry{available}
            case False{}:
              Bool.pick(Share, available, ShareAvailable{}, ShareDisabled{})

def copy_control(copy: Copy, enabled: Bool, available: Bool, sharing: Bool) -> Share:
  match copy:
    case Uploading{}:
      share_control(enabled, sharing, False{}, available)
    case UploadStopped{}:
      share_control(enabled, False{}, True{}, available)
    case other:
      share_control(enabled, False{}, False{}, available)

def completed_surface(result: Completion, +paste: Bool, inspect: Bool, enabled: Bool, online: Bool, audio_problem: Bool) -> Surface:
  match result:
    case Result{dismiss_at, recovery, +sharing, consent, +copy}:
      available = Bool.and(paste, Bool.and(online, Bool.not(sharing)))
      control = copy_control(copy, enabled, available, sharing)
      CompletedSurface{paste, inspect, control, copy, audio_problem}

def can_record(mode: Mode) -> Bool:
  match mode:
    case Screen{}:
      True{}
    case Iphone{}:
      True{}
    case other:
      False{}

def recording_surface(reveal: Reveal, phone: Bool, +no_words: Bool, notes: U32, movable: Bool, microphone_problem: Bool) -> Surface:
  match reveal:
    case Closed{}:
      RecordingSurface{False{}, no_words, phone, U32.min(notes, 100), movable, Bool.not(Bool.or(no_words, microphone_problem))}
    case Open{min_at, idle_at, leave_at, hovered, working, baseline}:
      RecordingSurface{True{}, False{}, phone, U32.min(notes, 100), movable, False{}}

def present(phase: Phase, facts: Facts) -> Surface:
  match phase facts:
    case Selecting{+mode} Facts{phone, no_words, note_count, movable, paste, inspect, enabled, online, microphone_problem, audio_problem}:
      PickerSurface{mode, can_record(mode), phone}
    case Recording{reveal} Facts{phone, no_words, note_count, movable, paste, inspect, enabled, online, microphone_problem, audio_problem}:
      recording_surface(reveal, phone, no_words, note_count, movable, microphone_problem)
    case Processing{released} Facts{phone, no_words, note_count, movable, paste, inspect, enabled, online, microphone_problem, audio_problem}:
      ProcessingSurface{}
    case Completed{result} Facts{phone, no_words, note_count, movable, paste, inspect, enabled, online, microphone_problem, audio_problem}:
      completed_surface(result, paste, inspect, enabled, online, audio_problem)
    case other rest:
      HiddenSurface{}
