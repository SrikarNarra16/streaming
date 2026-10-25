// Actions the client may record through /api/logs. To allow a new one, add it here.
export const ALLOWED_LOG_ACTIONS = [
  "start_button_click",
  "pause_button_click",
  "resume_button_click",
  "reset_button_click",
  "understand_button_click",
  "dont_understand_button_click",
  "blank_answer_submit",
  "ok_ai_output_button_click",
  "logout_button_click",
] as const;

export type AllowedLogAction = (typeof ALLOWED_LOG_ACTIONS)[number];
