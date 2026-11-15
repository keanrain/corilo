// Examiner labels may be plain, Markdown headings, or bold headings.
export function examinerSections(text) {
  const headings = [...text.matchAll(/^[\t ]*(?:(?:#{1,6}|[-*])[\t ]+)?(\*\*|__)?【([^】\r\n]+)】\1[\t ]*/gmu)]
  return headings.map((heading, i) => [heading[2],
    text.slice(heading.index + heading[0].length, headings[i + 1]?.index ?? text.length).trim()])
}
