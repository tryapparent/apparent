declare const preview: {
  lookup_metadata(document: boolean, bodyRequested: boolean): boolean;
  metadata_limit(ready: boolean, bodyRequested: boolean): number;
};
export default preview;
