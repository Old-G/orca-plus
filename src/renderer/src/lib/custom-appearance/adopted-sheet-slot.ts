/**
 * Custom build (custom-appearance): one replaceable constructed stylesheet per document.
 * Unlike custom.css, our own CSS may reference blob: URLs, so it skips the resource stripper.
 */
export function createAdoptedSheetSlot(): (doc: Document, css: string | null) => void {
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
    doc.adoptedStyleSheets = [...others, sheet]
    sheets.set(doc, sheet)
  }
}
