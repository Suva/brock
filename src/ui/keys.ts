// The window's keyboard belongs to the open view, except while something is
// being typed in (a text field, the notes, a title being edited) or a dialog
// is open (search, the trash, settings): those keep their keys.

/** Whether keys pressed on `target` belong to something else, which the views leave alone. */
export function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest('input, textarea, select, [role="dialog"]') !== null;
}
