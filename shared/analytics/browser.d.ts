export interface AnalyticsConfig { enabled: boolean; host: string; token: string; environment: string }
export function startAnalytics(config: AnalyticsConfig): void;
