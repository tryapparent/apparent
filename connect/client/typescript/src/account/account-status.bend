import Base

type Grant is Data:
  SignedOut{}
  Current{}
  Renewable{}
  Reapproval{}

type Outcome is Data:
  NoOutcome{}
  Offline{}
  AuthRequired{}
  Waitlisted{}
  Cancelled{}
  Rejected{}
  Expired{}
  LocalState{}
  InvalidServer{}
  UnverifiedCommit{}
  Unavailable{}

type Activity is Data:
  Idle{}
  Consent{}
  Starting{}
  Approval{}
  Resume{}
  Check{}
  Disable{}
  Disconnect{}
  ConfirmDisable{}
  ConfirmDisconnect{}

type Status is Data:
  SignedOutCard{}
  UploadsOn{}
  UploadsOff{}
  Renew{}
  SignInAgain{}
  Unreachable{}
  WaitlistCard{}
  CancelledCard{}
  RejectedCard{}
  ExpiredCard{}
  LocalError{}
  BadServer{}
  Unverified{}
  Unknown{}
  ConsentCard{}
  StartingCard{}
  ApprovalCard{}
  ResumeCard{}
  CheckCard{}
  DisableCard{}
  DisconnectCard{}
  ConfirmDisableCard{}
  ConfirmDisconnectCard{}

def saved_status(grant: Grant, uploads: Bool) -> Status:
  match grant uploads:
    case Reapproval{} _: SignInAgain{}
    case Renewable{} _: Renew{}
    case Current{} True{}: UploadsOn{}
    case Current{} False{}: UploadsOff{}
    case SignedOut{} _: SignedOutCard{}

def outcome_status(outcome: Outcome, saved: Status) -> Status:
  match outcome:
    case NoOutcome{}: saved
    case Offline{}: Unreachable{}
    case AuthRequired{}: SignInAgain{}
    case Waitlisted{}: WaitlistCard{}
    case Cancelled{}: CancelledCard{}
    case Rejected{}: RejectedCard{}
    case Expired{}: ExpiredCard{}
    case LocalState{}: LocalError{}
    case InvalidServer{}: BadServer{}
    case UnverifiedCommit{}: Unverified{}
    case Unavailable{}: Unknown{}

def active_status(activity: Activity, inactive: Status) -> Status:
  match activity:
    case Idle{}: inactive
    case Consent{}: ConsentCard{}
    case Starting{}: StartingCard{}
    case Approval{}: ApprovalCard{}
    case Resume{}: ResumeCard{}
    case Check{}: CheckCard{}
    case Disable{}: DisableCard{}
    case Disconnect{}: DisconnectCard{}
    case ConfirmDisable{}: ConfirmDisableCard{}
    case ConfirmDisconnect{}: ConfirmDisconnectCard{}

def account_status(grant: Grant, uploads: Bool, activity: Activity, outcome: Outcome, local: Outcome) -> Status:
  outcome_status(local, active_status(activity, outcome_status(outcome, saved_status(grant, uploads))))

type Tone is Data:
  Neutral{}
  Success{}
  Progress{}
  Warning{}
  Failure{}

type Copy is Data:
  Card{headline: String, detail: String, tone: Tone}

def status_copy(status: Status) -> Copy:
  match status:
    case SignedOutCard{}: Card{"Send captures to your cloud agent.", "", Neutral{}}
    case UploadsOn{}: Card{"Connect ready", "", Success{}}
    case UploadsOff{}: Card{"Connected · uploads off", "New captures stay on this computer until you enable uploads.", Neutral{}}
    case Renew{}: Card{"Connection needs a refresh.", "Check the connection to renew this device’s access. Local recording still works.", Warning{}}
    case SignInAgain{}: Card{"Sign in again.", "Approve this computer again to use Connect. Local recording still works.", Failure{}}
    case Unreachable{}: Card{"Connect is offline.", "Check your network and try again. Local recording still works and your upload choice is saved.", Failure{}}
    case WaitlistCard{}: Card{"You’re on the Connect waitlist.", "You can try connecting again later. Local recording still works.", Failure{}}
    case CancelledCard{}: Card{"Connection cancelled.", "Connect again when you’re ready.", Neutral{}}
    case RejectedCard{}: Card{"Sign-in wasn’t approved.", "Try again and approve this computer in your browser.", Failure{}}
    case ExpiredCard{}: Card{"That sign-in expired.", "Connect again for a new code.", Failure{}}
    case LocalError{}: Card{"Connection settings unavailable.", "Check local storage and refresh the connection settings.", Failure{}}
    case BadServer{}: Card{"Check your Connect server.", "Correct the configured server before connecting.", Failure{}}
    case Unverified{}: Card{"Connection not confirmed.", "Apparent could not verify that uploads are enabled. Check the connection before trying again.", Failure{}}
    case Unknown{}: Card{"Connect is unavailable.", "Try checking the connection again. Local recording still works.", Failure{}}
    case ConsentCard{}: Card{"Allow new capture uploads?", "New captures upload privately, including recordings, images, voice, transcripts and context. Older captures stay local. Sharing is a separate action.", Neutral{}}
    case StartingCard{}: Card{"Connecting…", "", Progress{}}
    case ApprovalCard{}: Card{"Approve in your browser.", "", Progress{}}
    case ResumeCard{}: Card{"Enabling uploads…", "", Progress{}}
    case CheckCard{}: Card{"Checking connection…", "", Progress{}}
    case DisableCard{}: Card{"Turning uploads off…", "Saving your choice and cancelling unfinished uploads.", Progress{}}
    case DisconnectCard{}: Card{"Disconnecting…", "Saving your choice and cancelling unfinished uploads.", Progress{}}
    case ConfirmDisableCard{}: Card{"Turn uploads off?", "Unfinished uploads stop. You stay signed in, and already uploaded captures remain.", Warning{}}
    case ConfirmDisconnectCard{}: Card{"Disconnect this computer?", "Unfinished uploads stop. Already uploaded captures and shared links remain.", Warning{}}

type Recovery is Data:
  Connect{}
  Enable{}
  SignIn{}
  Retry{}
  CheckAgain{}
  Refresh{}
  NoRecovery{}

def recovery(status: Status, grant: Grant, uploads: Bool) -> Recovery:
  match status grant uploads:
    case SignedOutCard{} _ _: Connect{}
    case UploadsOff{} _ _: Enable{}
    case SignInAgain{} _ _: SignIn{}
    case Unverified{} _ _: CheckAgain{}
    case Renew{} _ _: CheckAgain{}
    case LocalError{} _ _: Refresh{}
    case BadServer{} _ _: Refresh{}
    case CancelledCard{} _ True{}: CheckAgain{}
    case CancelledCard{} Current{} False{}: Enable{}
    case CancelledCard{} _ False{}: Connect{}
    case Unreachable{} SignedOut{} _: Retry{}
    case Unreachable{} _ _: CheckAgain{}
    case Unknown{} SignedOut{} _: Retry{}
    case Unknown{} _ _: CheckAgain{}
    case WaitlistCard{} _ _: Retry{}
    case RejectedCard{} _ _: Retry{}
    case ExpiredCard{} _ _: Retry{}
    case _ _ _: NoRecovery{}

law fault_overrides_saved_success:
  for operation: Activity
  {account_status(Current{}, True{}, operation, NoOutcome{}, LocalState{}) == LocalError{} : Status}

def fault_overrides_saved_success(operation):
  {==}

law expired_access_never_presents_ready:
  {account_status(Renewable{}, True{}, Idle{}, NoOutcome{}, NoOutcome{}) == Renew{} : Status}

def expired_access_never_presents_ready():
  {==}

def check_on_open(opened: Bool, check_available: Bool) -> Bool:
  match opened check_available:
    case False{} True{}: True{}
    case _ _: False{}
