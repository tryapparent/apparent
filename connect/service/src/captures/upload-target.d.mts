declare const policy: {
  problem(
    pathAllowed: boolean,
    listed: boolean,
  ): "invalid_path" | "not_found" | "";
};
export default policy;
