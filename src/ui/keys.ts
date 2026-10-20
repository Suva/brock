// The window's keyboard belongs to the open view, except while something is
// being typed in: a text field, the notes, a title being edited.

/** Whether keys pressed on `target` are typing, which the views leave alone. */
export function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest("input, textarea, select") !== null;
}
