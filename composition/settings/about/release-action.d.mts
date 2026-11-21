declare const policy: {
  release_action(current: boolean): string;
  staged_release_note(channel: string, id: string): string;
  show_restart(pending: boolean, checking: boolean): boolean;
  show_unstaged_restart_failure(restartFailure: boolean, restart: boolean): boolean;
  show_failure(failed: boolean, restartFailure: boolean, restart: boolean): boolean;
};

export default policy;
