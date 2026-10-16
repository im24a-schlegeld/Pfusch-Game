/** Customer reads and writes require explicit trust beyond a signed staff identity. */
export function isDashboardEditor(staffId: string, raw: string | undefined) {
  return Boolean(raw && raw.split(',').map(part => part.trim()).some(id => /^[1-9]\d{0,19}$/.test(id) && id === staffId));
}
