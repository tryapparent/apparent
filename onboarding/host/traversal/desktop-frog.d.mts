declare const policy: {
  naming_stage(active: boolean, named: boolean, revealed: boolean): number;
  accept_name(hasControl: boolean, length: number): boolean;
  desktop_visible(adopted: boolean, unavailable: boolean): boolean;
};
export default policy;
