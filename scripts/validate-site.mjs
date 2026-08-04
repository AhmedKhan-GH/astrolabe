import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative, resolve } from 'node:path'

const root = resolve('site')
const errors = []

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

const files = walk(root)
const htmlFiles = files.filter((file) => file.endsWith('.html'))

function idsIn(source) {
  return [...source.matchAll(/\sid=["']([^"']+)["']/g)].map((match) => match[1])
}

for (const file of htmlFiles) {
  const source = readFileSync(file, 'utf8')
  const label = relative(root, file)
  const ids = idsIn(source)
  const seen = new Set()

  for (const id of ids) {
    if (seen.has(id)) errors.push(`${label}: duplicate id "${id}"`)
    seen.add(id)
  }

  if (source.includes('/tree/main/')) {
    errors.push(`${label}: links to legacy main instead of the current rebuild branch`)
  }

  for (const match of source.matchAll(/\s(?:href|src)=["']([^"']+)["']/g)) {
    const value = match[1]
    if (
      /^(?:https?:|mailto:|tel:|data:|javascript:)/.test(value) ||
      value.startsWith('/astrolabe/')
    ) continue

    const [pathPart, fragment] = value.split('#', 2)
    let target = file
    if (pathPart) {
      const clean = pathPart.split('?')[0]
      target = normalize(resolve(dirname(file), clean))
      if (clean.endsWith('/')) target = join(target, 'index.html')
    }

    if (!existsSync(target)) {
      errors.push(`${label}: missing local target "${value}"`)
      continue
    }

    if (fragment && target.endsWith('.html')) {
      const targetIds = new Set(idsIn(readFileSync(target, 'utf8')))
      if (!targetIds.has(fragment)) {
        errors.push(`${label}: missing anchor "#${fragment}" in ${relative(root, target)}`)
      }
    }
  }
}

for (const required of ['.nojekyll', '404.html', 'robots.txt', 'sitemap.xml', 'assets/mark.svg']) {
  if (!existsSync(join(root, required))) errors.push(`site: missing required file "${required}"`)
}

const landing = readFileSync(join(root, 'index.html'), 'utf8')
if (!/<button\b[^>]*data-release-download[^>]*\sdisabled(?:\s|>)/.test(landing)) {
  errors.push('index.html: checked-in download control must start disabled')
}
if (/data-release-download[^>]+href=/.test(landing)) {
  errors.push('index.html: checked-in download control must not have a download URL')
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'))
  process.exit(1)
}

console.log(`Validated ${htmlFiles.length} HTML pages and ${files.length} site files.`)
