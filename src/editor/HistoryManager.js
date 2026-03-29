/**
 * HistoryManager — Undo/Redo stack for editor operations.
 */
export class HistoryManager {
  constructor(maxSteps = 50) {
    this.undoStack = [];
    this.redoStack = [];
    this.maxSteps = maxSteps;
  }

  /**
   * Push an action onto the undo stack.
   * @param {{ undo: Function, redo: Function, label: string }} action
   */
  push(action) {
    this.undoStack.push(action);
    if (this.undoStack.length > this.maxSteps) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  undo() {
    const action = this.undoStack.pop();
    if (!action) return null;
    action.undo();
    this.redoStack.push(action);
    return action;
  }

  redo() {
    const action = this.redoStack.pop();
    if (!action) return null;
    action.redo();
    this.undoStack.push(action);
    return action;
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}
