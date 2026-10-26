// Invented sample texts for the mock provider (TRACE_PROVIDER=mock). They are made up for local development
// and tests: a reasoning of about 250 words and a step-by-step text of about 330 words, each with a short
// code block. They are not taken from any real model output.

export const SAMPLE_REASONING = `We need a function that finds the biggest gap between neighbouring numbers once the list is sorted. First check the edge cases. A list with fewer than two numbers has no neighbours, so the answer should be 0.

Sorting is the natural first step. After sorting, the closest neighbours in value are also neighbours in position, so we only compare each element with the one before it. Sorting costs O(n log n), which is fine for a short exercise.

Let me walk through a small example. Take [7, 1, 4, 10]. Sorted it becomes [1, 4, 7, 10]. The gaps are 3, 3 and 3, so the answer is 3. Another example: [5, 20, 6]. Sorted: [5, 6, 20]. The gaps are 1 and 14, so the answer is 14. Good, the idea works.

Now the loop. Keep a variable best that starts at 0. For each index from 1 to the end, compute the difference between the current value and the previous one, and keep the larger one. Duplicates give a gap of 0, which is harmless.

def largest_gap(nums):
    if len(nums) < 2:
        return 0
    ordered = sorted(nums)
    best = 0
    for i in range(1, len(ordered)):
        best = max(best, ordered[i] - ordered[i - 1])
    return best

Check the code on [5, 20, 6]: ordered is [5, 6, 20], first gap 1, second gap 14, best is 14. Correct. Also sorted() returns a new list, so the input list is not changed, which is a nice property to mention.`;

/** What the reasoning call's own answer is, in the mock. The orchestration reads and ignores it. */
export const SAMPLE_REASONING_ANSWER = `def largest_gap(nums):
    if len(nums) < 2:
        return 0
    ordered = sorted(nums)
    return max(b - a for a, b in zip(ordered, ordered[1:]))`;

export const SAMPLE_STEPS = `Let us work out how to find the largest gap between neighbouring numbers, step by step.

First, think about what "neighbouring" means. If the numbers are in a random order, two values that are close together may be far apart in the list. Once the list is sorted, close values sit next to each other, so we only ever need to compare an element with the one right before it.

Second, handle the small cases. With fewer than two numbers there is nothing to compare, so we return 0 straight away. This keeps the rest of the function free of special cases.

Third, sort a copy of the list. The built-in sorted function returns a new list and leaves the original alone, which is a good habit when a function receives data it does not own.

Now a worked example with concrete values. Take [7, 1, 4, 10]. After sorting we have [1, 4, 7, 10]. Comparing neighbours gives 4 - 1 = 3, 7 - 4 = 3 and 10 - 7 = 3, so the largest gap is 3. With [5, 20, 6] the sorted list is [5, 6, 20], the gaps are 1 and 14, and the answer is 14.

The fourth step is the loop. We keep a variable called best that starts at 0 and, for every position from 1 to the end, replace it with the larger of its current value and the new gap. Starting at 0 is safe because a gap can never be negative in a sorted list, and duplicates simply produce a gap of 0.

Here is the whole function:

\`\`\`python
def largest_gap(nums):
    if len(nums) < 2:
        return 0
    ordered = sorted(nums)
    best = 0
    for i in range(1, len(ordered)):
        best = max(best, ordered[i] - ordered[i - 1])
    return best
\`\`\`

Finally, check the cost. Sorting takes O(n log n) time and the loop takes O(n), so sorting dominates. For a list of a few thousand numbers this finishes instantly, and the code stays short enough to read in one glance.`;
