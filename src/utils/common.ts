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

/**
 * Checks if a given value is null or undefined.
 * @param value The value to check.
 * @returns A boolean indicating whether the value is null or undefined.
 * @example
 * isNullish(null); // true
 * isNullish(undefined); // true
 * isNullish(0); // false
 */

export function isNullish<T>(value: T | null | undefined): value is null | undefined {
    return value === null || value === undefined;
}
