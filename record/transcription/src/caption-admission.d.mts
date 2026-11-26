declare const policy: {
  openrouter_cli_alt_model_allowed(model: string): boolean;
  openrouter_speech_format(author: string): string;
  openrouter_model_allowed(model: string): boolean;
  openrouter_allowed(enabled: boolean, model: string): boolean;
  preview_allowed(enabled: boolean, supported: boolean): boolean;
};
export default policy;
