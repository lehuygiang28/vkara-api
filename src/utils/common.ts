/**
 * Shuffles an array in-place.
 * @param array The array to shuffle.
 * @returns The shuffled array.
 * @example
 * const array = [1, 2, 3];
 * shuffleArray(array);
 * console.log(array); // [2, 1, 3]
 */
export function shuffleArray<T>(array: T[]): T[] {
    if (!Array.isArray(array)) {
        return array;
    }

    if (array.length === 0 || array.length === 1) {
        return array;
    }

    if (array.length === 2) {
        return [array[1], array[0]];
    }

    return array.sort(() => Math.random() - 0.5);
}
