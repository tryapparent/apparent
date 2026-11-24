declare const policy: {
  picker_enabled(
    canonicalPresent: boolean,
    canonicalEnabled: boolean,
    legacyEnabled: boolean,
  ): boolean;
  show_computers(saved: boolean, known: boolean): boolean;
  computer_status(expired: boolean, checked: boolean, reachable: boolean): 0 | 1 | 2 | 3;
  environment_icon(selected: number, detected: number): number;
};
export default policy;
