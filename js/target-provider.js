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
}

export class PicsumProvider extends TargetProvider {
  /**
   * Fetches a deterministic image for the given coordinate from picsum.photos.
   * The seed is derived from the coordinate (dash removed).
   * Returns only a Blob — never creates an object URL (caller decides when to reveal).
   */
  async getTarget(coordinate) {
    const seed = coordinate.replace('-', '');
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
      metadata: {
        source: 'picsum',
        seed,
        url,
        width: 800,
        height: 600,
      },
    };
  }
}
