/**
 * TargetProvider — abstraction layer for RV target images.
 * Swap PicsumProvider for a server-based provider later without changing callers.
 */
export class TargetProvider {
  /**
   * @param {string} coordinate - The RV session coordinate (e.g. "1234-5678")
   * @returns {Promise<{imageBlob: Blob, seed: string, metadata: object}>}
   */
  async getTarget(coordinate) {
    throw new Error('Not implemented');
  }

  /**
   * For ARV: fetch two visually different images for the same trial.
   * @param {string} coordinate
   * @returns {Promise<{ A: {imageBlob, seed, metadata}, B: {imageBlob, seed, metadata} }>}
   */
  async getTargetPair(coordinate) {
    throw new Error('Not implemented');
  }
}

export class PicsumProvider extends TargetProvider {
  /**
   * Fetches a deterministic image for the given seed from picsum.photos.
   * Returns only a Blob — never creates an object URL (caller decides when to reveal).
   */
  async getTargetBySeed(seed) {
    const url = `https://picsum.photos/seed/${seed}/800/600`;
    let response;
    try {
      response = await fetch(url);
    } catch (err) {
      throw new Error(`Netzwerkfehler beim Laden des Targets: ${err.message}`);
    }
    if (!response.ok) {
      throw new Error(`Target konnte nicht geladen werden (HTTP ${response.status})`);
    }
    const imageBlob = await response.blob();
    return {
      imageBlob,
      seed,
      metadata: { source: 'picsum', seed, url, width: 800, height: 600 },
    };
  }

  async getTarget(coordinate) {
    const seed = coordinate.replace('-', '');
    return this.getTargetBySeed(seed);
  }

  /**
   * Returns two visually different images for ARV trials.
   * Appends 'a' / 'b' to the seed so picsum serves different photos.
   */
  async getTargetPair(coordinate) {
    const seed = coordinate.replace('-', '');
    const [A, B] = await Promise.all([
      this.getTargetBySeed(seed + 'a'),
      this.getTargetBySeed(seed + 'b'),
    ]);
    return { A, B };
  }
}
