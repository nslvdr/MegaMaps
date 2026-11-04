/** The same SVG markup with these classes on its root element. */
export function withClass(svg: string, className: string) {
  if (!className) return svg;
  return /^<svg[^>]*\sclass="/.test(svg)
    ? svg.replace(/^(<svg[^>]*\sclass=")/, `$1${className} `)
    : svg.replace(/^<svg/, `<svg class="${className}"`);
}
