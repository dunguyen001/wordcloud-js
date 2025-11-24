declare class IntegralOccupancyMap {
    private height;
    private width;
    private grid;
    private integral;
    constructor(height: number, width: number, mask?: Uint8Array | number[]);
    private _ingestMask;
    recomputeIntegral(): void;
    private area;
    samplePosition(sizeX: number, sizeY: number, random: {
        randint(min: number, max: number): number;
    }): [number, number] | null;
    occupyRect(x: number, y: number, sizeX: number, sizeY: number): void;
}
export default IntegralOccupancyMap;
