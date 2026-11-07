// Once a signed Apple-silicon release is published on GitHub, the greyed download becomes a link to its disk image.
// The checked-in page is the truthful no-release state, so failures and rate limits leave it as it is.
(() => {
  const control = document.querySelector('[data-release-download]')
  if (!control) return

  fetch('https://api.github.com/repos/AhmedKhan-GH/astrolabe/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
    .then((response) => {
      if (!response.ok) throw new Error('No public release')
      return response.json()
    })
    .then((release) => {
      if (release.draft || release.prerelease || !Array.isArray(release.assets)) return
      const dmg = release.assets.find((asset) =>
        /^Astrolabe-.+-arm64\.dmg$/i.test(asset.name) && !asset.name.toLowerCase().includes('unsigned'))
      const checksum = release.assets.find((asset) => asset.name === 'SHA256SUMS.txt')
      const manifest = release.assets.find((asset) => asset.name === 'release-manifest.json')
      if (!dmg || !checksum || !manifest) return

      const link = document.createElement('a')
      link.className = 'btn btn-ghost'
      link.href = dmg.browser_download_url
      link.dataset.releaseDownload = ''
      link.dataset.releaseAsset = dmg.name
      link.textContent = `Download ${release.tag_name}`
      control.replaceWith(link)
    })
    .catch(() => {})
})()
