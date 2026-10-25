// The "step by step" fallback prompt: asks a model that is not in thinking mode to work the problem
// out loud, so its ANSWER reads like a reasoning trace. All wording lives here, as constants, so it is
// easy to edit. buildStepsPrompt() only assembles it.

/** Target length of the whole reply, in words. */
export const STEPS_WORD_TARGET = { min: 300, max: 400 } as const;

export const STEPS_PROMPT_INTRO =
  "Solve the following programming problem by thinking it through step by step, the way a person works it out while a learner follows along.";

export const STEPS_PROMPT_RULES: readonly string[] = [
  "Explain what each step does and why, in one to three sentences.",
  "Include a short worked example with concrete values.",
  "Finish with the code.",
  `Aim for ${STEPS_WORD_TARGET.min} to ${STEPS_WORD_TARGET.max} words in total.`,
  "Write plain paragraphs separated by blank lines. Do not use headings, bullet points or bold text.",
];

/** Introduces the question text, which always comes last. */
export const STEPS_PROMPT_QUESTION_LABEL = "The problem:";

export function buildStepsPrompt(question: string): string {
  const instructions = [STEPS_PROMPT_INTRO, ...STEPS_PROMPT_RULES].join(" ");
  return `${instructions}\n\n${STEPS_PROMPT_QUESTION_LABEL}\n${question.trim()}`;
}
