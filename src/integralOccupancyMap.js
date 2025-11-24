class IntegralOccupancyMap {
  constructor(height, width, mask) {
    this.height = height;
    this.width = width;
    this.grid = new Uint8Array(height * width);
    if (mask) {
      this._ingestMask(mask);
    }
    this.integral = new Uint32Array((height + 1) * (width + 1));
    this.recomputeIntegral();
  }

  _ingestMask(mask) {
    // mask is expected to be a flat array of length height * width.
    if (mask.length !== this.grid.length) {
      throw new Error(`Mask size mismatch. Expected ${this.grid.length}, got ${mask.length}`);
    }
    for (let i = 0; i < mask.length; i++) {
      const blocked = mask[i];
      this.grid[i] = blocked ? 1 : 0;
    }
  }

  recomputeIntegral() {
    const w1 = this.width + 1;
    const integral = this.integral;
    // reset first row
    integral.fill(0);
    for (let i = 0; i < this.height; i++) {
      let rowSum = 0;
      for (let j = 0; j < this.width; j++) {
        rowSum += this.grid[i * this.width + j];
        const idx = (i + 1) * w1 + (j + 1);
        integral[idx] = integral[idx - w1] + rowSum;
      }
    }
  }

  area(x1, y1, x2, y2) {
    // compute integral over [x1, x2) x [y1, y2)
    const w1 = this.width + 1;
    const a = this.integral[x1 * w1 + y1];
    const b = this.integral[x2 * w1 + y2];
    const c = this.integral[x1 * w1 + y2];
    const d = this.integral[x2 * w1 + y1];
    return a + b - c - d;
  }

  samplePosition(sizeX, sizeY, random) {
    const maxX = this.height - sizeX;
    const maxY = this.width - sizeY;
    if (maxX < 0 || maxY < 0) return null;
    let hits = 0;
    for (let i = 0; i <= maxX; i++) {
      for (let j = 0; j <= maxY; j++) {
        if (this.area(i, j, i + sizeX, j + sizeY) === 0) {
          hits += 1;
        }
      }
    }
    if (!hits) return null;
    const goal = random.randint(0, hits - 1);
    let seen = 0;
    for (let i = 0; i <= maxX; i++) {
      for (let j = 0; j <= maxY; j++) {
        if (this.area(i, j, i + sizeX, j + sizeY) === 0) {
          if (seen === goal) {
            return [i, j];
          }
          seen += 1;
        }
      }
    }
    return null;
  }

  occupyRect(x, y, sizeX, sizeY) {
    for (let i = 0; i < sizeX; i++) {
      const row = x + i;
      for (let j = 0; j < sizeY; j++) {
        const col = y + j;
        this.grid[row * this.width + col] = 1;
      }
    }
    this.recomputeIntegral();
  }
}

module.exports = IntegralOccupancyMap;
