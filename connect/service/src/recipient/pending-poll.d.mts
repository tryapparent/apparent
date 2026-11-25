declare const pendingPoll: {
  lifetime(): number;
  can_poll(remaining: number, attempts: number): boolean;
  wait_ms(
    remaining: number,
    sinceLast: number,
    attempts: number,
    visible: boolean,
    foreground: boolean,
  ): number;
};

export default pendingPoll;
