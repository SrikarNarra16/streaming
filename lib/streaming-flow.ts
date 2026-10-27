// Pure rules for the streaming page's controls.

export interface ResumeState {
  /** A blank input is on screen (also while its "Correct/Incorrect" message is showing). */
  isWaitingForBlankFill: boolean;
  /** The "Am I making sense?" box is on screen. */
  isWaitingForFeedback: boolean;
  /** The chat accordion after "I don't understand" is open. */
  hasActiveAccordion: boolean;
  /** The typing loop already stopped at the end of a paragraph (the feedback box is on its way). */
  isAtParagraphEnd: boolean;
  /** The whole content has been typed. */
  isContentComplete: boolean;
}

/**
 * Should typing start again when the learner presses Resume?
 * Only when the pause interrupted typing in the middle of a paragraph. If the page is waiting for the learner
 * (a blank, the feedback box, the chat) or the paragraph is finished, Resume must not type on: the next
 * paragraph would be appended to the one that has not been answered yet, or text would run under a blank input.
 */
export function shouldTypeOnResume(state: ResumeState): boolean {
  return !(state.isWaitingForBlankFill || state.isWaitingForFeedback || state.hasActiveAccordion || state.isAtParagraphEnd || state.isContentComplete);
}
