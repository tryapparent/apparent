declare const policy: {
  available(requested: boolean, ready: boolean, encrypted: boolean): boolean;
  token_budget(): number;
  scan_limit(): number;
};
export default policy;
