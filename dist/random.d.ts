export default class RNG {
    private state;
    constructor(seed?: number);
    next(): number;
    randint(min: number, max: number): number;
}
