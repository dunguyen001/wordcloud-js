// Simple deterministic RNG so the layout can be reproduced with a seed.
export default class RNG {
  private state: number;

  constructor(seed: number = Date.now()) {
    this.state = seed >>> 0;
  }

  next(): number {
    // Mulberry32 PRNG
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  randint(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
}
