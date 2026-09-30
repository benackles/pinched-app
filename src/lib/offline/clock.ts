/** The client clock, behind a function so event handlers can stamp changes without an impure call in render code. */
export const now = (): number => Date.now();
