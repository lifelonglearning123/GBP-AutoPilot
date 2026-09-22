/**
 * What approving a categories draft does to the categories on Google. Shared by the server (which
 * saves it) and the draft card (which shows it), so what you see is exactly what is saved.
 *
 * A draft adds, it never removes: it sets its primary and adds its extras, keeps every extra already
 * on the profile (they may have been added by hand after the draft was written), and keeps the old
 * primary as an extra. Removing a category is a deliberate step in the category picker.
 */
export type CatRef = { name: string; displayName?: string };

export const MAX_ADDITIONAL = 9;

export function mergeCategoryDraft(
  current: { primary?: CatRef | null; additional: CatRef[] },
  draft: { primary: CatRef; additional?: CatRef[] },
): { primary: CatRef; additional: (CatRef & { isNew: boolean })[]; dropped: CatRef[] } {
  const primary = draft.primary;
  const seen = new Set<string>([primary.name]);
  const all: (CatRef & { isNew: boolean })[] = [];
  const push = (c: CatRef, isNew: boolean) => { if (!seen.has(c.name)) { seen.add(c.name); all.push({ ...c, isNew }); } };
  for (const c of current.additional) push(c, false);
  if (current.primary && current.primary.name !== primary.name) push(current.primary, false);
  for (const c of draft.additional ?? []) push(c, true);
  return { primary, additional: all.slice(0, MAX_ADDITIONAL), dropped: all.slice(MAX_ADDITIONAL) };
}
