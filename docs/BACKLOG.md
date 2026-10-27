# Backlog

Follow-ups that are not done yet.

## Blank generator (draft, `lib/blanks`)
- Treat negative numbers such as "-1" as spacing-safe (today any answer containing `-` is held back as spacing-sensitive).
- Skip "O(1)" blanks (the answer "1" is too easy).

## Live trace integration
- Run the browser checks for the flag-off and flag-on paths (flag-on with `TRACE_PROVIDER=mock`) before the study.

## Questions for the professor
- One saved trace per question, shown to every learner, instead of a new trace on each request?
- Should grading ignore spacing (so `low=mid+1` matches `low = mid + 1`)?
- What should the blanks test (algorithm steps, terms, numbers, complexity)?
