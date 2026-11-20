type Tag<T extends string> = { $: T };
export type Grant = "SignedOut" | "Current" | "Renewable" | "Reapproval";
export type Outcome =
  | "NoOutcome"
  | "Offline"
  | "AuthRequired"
  | "Waitlisted"
  | "Cancelled"
  | "Rejected"
  | "Expired"
  | "LocalState"
  | "InvalidServer"
  | "UnverifiedCommit"
  | "Unavailable";
export type Activity =
  | "Idle"
  | "Consent"
  | "Starting"
  | "Approval"
  | "Resume"
  | "Check"
  | "Disable"
  | "Disconnect"
  | "ConfirmDisable"
  | "ConfirmDisconnect";
export type Status =
  | "SignedOutCard"
  | "UploadsOn"
  | "UploadsOff"
  | "Renew"
  | "SignInAgain"
  | "Unreachable"
  | "WaitlistCard"
  | "CancelledCard"
  | "RejectedCard"
  | "ExpiredCard"
  | "LocalError"
  | "BadServer"
  | "Unverified"
  | "Unknown"
  | "ConsentCard"
  | "StartingCard"
  | "ApprovalCard"
  | "ResumeCard"
  | "CheckCard"
  | "DisableCard"
  | "DisconnectCard"
  | "ConfirmDisableCard"
  | "ConfirmDisconnectCard";
type Tone = "Neutral" | "Success" | "Progress" | "Warning" | "Failure";
export type Recovery =
  | "Connect"
  | "Enable"
  | "SignIn"
  | "Retry"
  | "CheckAgain"
  | "Refresh"
  | "NoRecovery";
declare const policy: {
  account_status(
    grant: Tag<Grant>,
    uploads: boolean,
    activity: Tag<Activity>,
    outcome: Tag<Outcome>,
    local: Tag<Outcome>,
  ): Tag<Status>;
  status_copy(
    status: Tag<Status>,
  ): Tag<"Card"> & { headline: string; detail: string; tone: Tag<Tone> };
  recovery(
    status: Tag<Status>,
    grant: Tag<Grant>,
    uploads: boolean,
  ): Tag<Recovery>;
};
export default policy;
