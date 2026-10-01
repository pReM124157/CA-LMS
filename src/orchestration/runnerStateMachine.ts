export const states = ['BOOTING','RESTORING_SESSION','AUTH_REQUIRED','DASHBOARD','SCANNING_COURSES','SCANNING_LESSONS','OPENING_LESSON','DETECTING_PLAYER','PLAYING','VIDEO_STALLED','QUESTION_DETECTED','SOLVING_QUESTION','WAITING_FOR_CONFIRMATION','SUBMITTING_ANSWER','VERIFYING_ANSWER','RESUMING_VIDEO','VERIFYING_COMPLETION','OPENING_NEXT_LESSON','PAUSED','RECOVERING','COMPLETED','ERROR'] as const;
export type RunnerState = typeof states[number];
export class RunnerStateMachine {
  public state: RunnerState = 'BOOTING';
  transition(next: RunnerState): { from: RunnerState; to: RunnerState } { const from = this.state; this.state = next; return { from, to: next }; }
}
