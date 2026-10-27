# Backlog

Follow-ups that are not done yet.

## Blank generator
- Blanking a variable name inside an assignment (for example "set BLANK(high) = mid - 1") is a weak blank. Tune with the professor's criteria.

## Live trace integration
- Run the browser checks for the flag-off and flag-on paths (flag-on with `TRACE_PROVIDER=mock`) before the study.

## Questions for the professor
- One saved trace per question, shown to every learner, instead of a new trace on each request?
- Should grading ignore spacing (so `low=mid+1` matches `low = mid + 1`)?
- What should the blanks test (algorithm steps, terms, numbers, complexity)?

## Typing clock calibration (before `TYPING_CLOCK = "raf"` can be used)
1. With `TYPING_CLOCK = "legacy"` (the default) run `node_modules/.bin/next dev`, log in, press Start on a question.
2. Open the browser console, paste `local-setup/measure-typing.js`, wait about 8 s without clicking. Note "characters per second (while typing)". Repeat 3 times, on a typical machine and a slow one, and on a question with no blank in the first 10 s. Use the median.
3. Set `CHARS_PER_SECOND` in `lib/typing-clock.ts` to that number (and update its comment with the date, machine and measured values).
4. Set `TYPING_CLOCK = "raf"` in `app/streaming/page.tsx` and measure again on the same question. The characters per second should match within a few percent, with a steadier gap between characters.
5. Run the browser checks (pause and resume, reset, hidden tab, scroll up while typing, blank input), then record the switch in `docs/STUDY-CHANGES.md` as a possible small change to `time_spent`.
6. Only then ask the professor whether the study may use `"raf"`.

