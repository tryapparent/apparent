declare const policy: {
  advertised_limit(extended: boolean, currentClient: boolean): number | bigint;
  upload_size(extended: boolean, bytes: number): boolean;
};
export default policy;
