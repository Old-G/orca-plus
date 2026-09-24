/**
 * Custom build (custom-appearance): one replaceable constructed stylesheet per document.
 * Unlike custom.css, our own CSS may reference blob: URLs, so it skips the resource stripper.
 */
export function createAdoptedSheetSlot({ prepend = false } = {}): (
  doc: Document,
  css: string | null
) => void {
  const sheets = new WeakMap<Document, CSSStyleSheet>()
  return (doc, css) => {
    const previous = sheets.get(doc)
    const others = doc.adoptedStyleSheets.filter((sheet) => sheet !== previous)
    if (css === null) {
      doc.adoptedStyleSheets = others
      sheets.delete(doc)
      return
    }
    const sheet = previous ?? new CSSStyleSheet()
    sheet.replaceSync(css)
    // Why prepend: a sheet placed first still beats document styles but loses ties to later ones.
    doc.adoptedStyleSheets = prepend ? [sheet, ...others] : [...others, sheet]
    sheets.set(doc, sheet)
  }
}
