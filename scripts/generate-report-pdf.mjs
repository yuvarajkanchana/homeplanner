import fs from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(process.cwd())
const inputPath = path.join(root, 'HOMEPLANNER_PROJECT_REPORT.md')
const outputPath = path.join(root, 'HomePlanner_Project_Report.pdf')
const md = await fs.readFile(inputPath, 'utf8')

function cleanText(value) {
  return value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '')
}

function wrap(text, maxChars) {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return ['']
  const lines = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (candidate.length > maxChars && line) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  if (line) lines.push(line)
  return lines
}

const pageW = 612
const pageH = 792
const margin = 54
const bottom = 54
const pages = []
let page = []
let y = pageH - margin

function newPage() {
  if (page.length) pages.push(page)
  page = []
  y = pageH - margin
}

function ensure(space) {
  if (y - space < bottom) newPage()
}

function addLine(text, size = 10.5, font = 'F1', indent = 0, leading = size + 4) {
  ensure(leading)
  page.push({ text, size, font, x: margin + indent, y })
  y -= leading
}

function addWrapped(text, size = 10.5, font = 'F1', indent = 0, before = 0, after = 0) {
  if (before) y -= before
  const maxChars = Math.max(28, Math.floor((pageW - margin * 2 - indent) / (size * 0.52)))
  for (const line of wrap(text, maxChars)) addLine(line, size, font, indent, size + 4)
  if (after) y -= after
}

for (const raw of cleanText(md).split(/\r?\n/)) {
  const line = raw.trimEnd()
  if (!line.trim()) {
    y -= 6
    if (y < bottom) newPage()
    continue
  }
  if (/^---+$/.test(line.trim())) {
    y -= 8
  } else if (line.startsWith('# ')) {
    addWrapped(line.replace(/^#\s+/, ''), 18, 'F2', 0, 10, 8)
  } else if (line.startsWith('## ')) {
    addWrapped(line.replace(/^##\s+/, ''), 14, 'F2', 0, 10, 6)
  } else if (line.startsWith('### ')) {
    addWrapped(line.replace(/^###\s+/, ''), 12, 'F2', 0, 8, 4)
  } else if (/^-\s+/.test(line.trim())) {
    addWrapped('- ' + line.trim().replace(/^-\s+/, ''), 10.5, 'F1', 14, 1, 1)
  } else if (/^\d+\.\s+/.test(line.trim())) {
    addWrapped(line.trim(), 10.5, 'F1', 14, 1, 1)
  } else if (/^\|/.test(line.trim())) {
    addWrapped(line.replace(/\|/g, '  '), 8.5, 'F3', 0, 1, 1)
  } else {
    addWrapped(line.trim(), 10.5, 'F1', 0, 1, 1)
  }
}
if (page.length) pages.push(page)

function escapePdf(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

const objects = []
function addObject(value) {
  objects.push(value)
  return objects.length
}

const catalogId = 1
const pagesId = 2
objects.push('')
objects.push('')
const font1 = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
const font2 = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>')
const font3 = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>')
const pageIds = []

for (let index = 0; index < pages.length; index += 1) {
  const commands = pages[index].map((item) =>
    `BT /${item.font} ${item.size} Tf ${item.x.toFixed(2)} ${item.y.toFixed(2)} Td (${escapePdf(item.text)}) Tj ET`
  )
  commands.push(`BT /F1 8 Tf ${(pageW - margin).toFixed(2)} 28 Td (${index + 1}) Tj ET`)
  const stream = commands.join('\n')
  const contentId = addObject(`<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`)
  const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R /F3 ${font3} 0 R >> >> /Contents ${contentId} 0 R >>`)
  pageIds.push(pageId)
}

objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`
objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`

let pdf = '%PDF-1.4\n'
const offsets = [0]
for (let index = 0; index < objects.length; index += 1) {
  offsets.push(Buffer.byteLength(pdf, 'ascii'))
  pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`
}
const xrefOffset = Buffer.byteLength(pdf, 'ascii')
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
for (let index = 1; index <= objects.length; index += 1) {
  pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
}
pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`

await fs.writeFile(outputPath, Buffer.from(pdf, 'ascii'))
console.log(`Wrote ${outputPath}`)
console.log(`Pages: ${pages.length}`)
