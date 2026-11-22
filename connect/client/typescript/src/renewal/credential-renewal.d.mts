declare const policy: {
  before_request(
    refreshExpired: boolean,
    accessSeconds: number,
  ): "force" | "renew" | "send";
  under_renewal_lock(
    changed: boolean,
    force: boolean,
    accessSeconds: number,
    hasRefresh: boolean,
  ): "reuse" | "reapprove" | "readJournal";
  resume_renewal(
    completed: boolean,
    refreshExpired: boolean,
  ): "recover" | "reapprove" | "exchange";
  after_transport(
    rejected: boolean,
    canRetry: boolean,
  ): "return" | "renew" | "reapprove";
};
export default policy;
