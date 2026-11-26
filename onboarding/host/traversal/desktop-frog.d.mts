declare const policy: {
  naming_stage(active: boolean, named: boolean, revealed: boolean): number;
  accept_name(hasControl: boolean, length: number): boolean;
  desktop_visible(adopted: boolean, unavailable: boolean): boolean;
  clamp_offset(wanted: number, extent: number, size: number): number;
  desktop_pause_ms(): number;
};
export default policy;
