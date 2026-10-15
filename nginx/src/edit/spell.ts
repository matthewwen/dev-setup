const KEY = "md-edit-spell";

export function readSpell(): boolean {
  return localStorage.getItem(KEY) !== "0";
}

export function writeSpell(on: boolean): void {
  localStorage.setItem(KEY, on ? "1" : "0");
}
