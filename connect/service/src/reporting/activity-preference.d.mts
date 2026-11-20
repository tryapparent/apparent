declare const preference: {
  may_queue(gpc: boolean, dnt: boolean): boolean;
  upload_increment(completedUpload: boolean): number;
};

export default preference;
