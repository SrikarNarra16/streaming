// Hand-written, invented reasoning-style traces used by the tests and by scripts/blanks-preview.ts (--fixture).
// No model produced them. Paragraphs are separated by a blank line.

export const BINARY_SEARCH_TRACE = `We are given a sorted array of integers and a target, and we must return the index of the target or -1 if it is missing. Because the array is sorted, binary search is better than scanning every item one by one.

Keep two pointers, low and high, that mark the part of the array where the target could still be. At the start low is 0 and high is len(arr) - 1. The middle index is mid = (low + high) // 2, and we look at arr[mid] first.

If arr[mid] == target we are done and we return mid. Otherwise, if arr[mid] < target, then the target must be on the right side, so we discard the left half and set low = mid + 1. If the middle item is larger, we set high = mid - 1 instead.

Let me trace an example. Take arr = [2, 5, 8, 12, 16, 23, 38] and target 23. Start with low=0 and high=6, so mid=3 and arr[3] is 12. Since 12 < 23 we move right with low=4. Now mid=5 and arr[5] is 23, which is the target, so we return 5.

The loop runs while low <= high. If low ever becomes larger than high, the range is empty and the target is not present, so we return -1. Each step halves the range, so the running time is O(log n) and the extra space is O(1).

def search(arr, target):
    low, high = 0, len(arr) - 1
    while low <= high:
        mid = (low + high) // 2
        if arr[mid] == target:
            return mid
        if arr[mid] < target:
            low = mid + 1
        else:
            high = mid - 1
    return -1

Check the edge cases. An empty array returns -1 at once, and a single element works because low equals high and mid lands on it. Duplicates are fine too, since we only need any matching index, not the first one.`;

export const SPIRAL_MATRIX_TRACE = `We need to return every element of an m by n matrix in spiral order, starting at the top left and going right, then down, then left, then up, and repeating inward until each cell has been visited once.

Track four boundaries: top, bottom, left and right. Initially top is 0, bottom is m - 1, left is 0 and right is n - 1. We keep walking while top <= bottom and left <= right, because once the boundaries cross there is nothing left to visit.

First walk along the top row from left to right and add each entry to the output. Then move the top boundary down with top += 1 so that the row is not read again. Next walk down the right column and shrink it with right -= 1.

Now there is a trap. After the top and right boundaries have moved, we must check that top <= bottom still holds before walking the bottom row, otherwise a matrix with a single row would be read twice. The same check with left <= right protects the left column.

For the matrix [[1, 2, 3], [4, 5, 6], [7, 8, 9]] the walk gives 1, 2, 3, then 6, 9, then 8, 7, then 4, and finally 5 in the middle, so the output is [1, 2, 3, 6, 9, 8, 7, 4, 5].

Every cell is visited exactly once, so the running time is O(m*n) where m is the number of rows and n the number of columns. Apart from the output, we only store the four boundaries, so the extra space is O(1).`;
