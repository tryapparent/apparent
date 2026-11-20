declare const policy: {
  release_action(linux: boolean): string;
  show_restart(pending: boolean, checking: boolean): boolean;
  show_restart_later(restart: boolean, offer: boolean): boolean;
  show_unstaged_restart_failure(restartFailure: boolean, restart: boolean): boolean;
  show_failure(failed: boolean, restartFailure: boolean, restart: boolean): boolean;
};

export default policy;
