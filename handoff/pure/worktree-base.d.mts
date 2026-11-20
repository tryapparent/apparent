declare const policy: {
  base_priority(
    marked: boolean,
    remote: boolean,
    main: boolean,
    master: boolean,
  ): number;
  base_resolved(priority: number): boolean;
};
export default policy;
