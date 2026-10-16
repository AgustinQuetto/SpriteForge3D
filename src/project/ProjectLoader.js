// Let the loading dialog paint and process cancellation between small batches.
export async function yieldProjectLoad(signal) {
  if (signal?.aborted) throw new DOMException('Project load cancelled', 'AbortError');
  await new Promise(resolve => setTimeout(resolve, 0));
  if (signal?.aborted) throw new DOMException('Project load cancelled', 'AbortError');
}

export class ProjectLoader {
  constructor({ prepare, commit, dispose, onBusy = () => {} }) {
    Object.assign(this, { prepare, commit, dispose, onBusy });
    this.revision = 0;
    this.controller = null;
  }

  async load(input) {
    this.controller?.abort();
    const revision = ++this.revision;
    const controller = new AbortController(); this.controller = controller;
    this.onBusy(true);
    let prepared;
    try {
      prepared = await this.prepare(input, controller.signal);
      if (revision !== this.revision || controller.signal.aborted) return false;
      this.commit(prepared);
      prepared = null; // Commit takes ownership only after returning successfully.
      return true;
    } catch (error) {
      if (controller.signal.aborted || revision !== this.revision) return false;
      throw error;
    } finally {
      if (prepared) this.dispose(prepared);
      if (revision === this.revision) { this.controller = null; this.onBusy(false); }
    }
  }

  cancel() {
    this.revision++;
    this.controller?.abort(); this.controller = null; this.onBusy(false);
  }
}
