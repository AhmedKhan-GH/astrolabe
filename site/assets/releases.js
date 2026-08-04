(() => {
  const card = document.querySelector('[data-release-card]')
  if (!card) return

  const api = 'https://api.github.com/repos/AhmedKhan-GH/astrolabe/releases/latest'

  const formatBytes = (bytes) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return null
    const megabytes = bytes / (1024 * 1024)
    return `${megabytes >= 100 ? megabytes.toFixed(0) : megabytes.toFixed(1)} MB`
  }

  const formatDate = (value) => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null
    return new Intl.DateTimeFormat('en', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(date)
  }

  fetch(api, { headers: { Accept: 'application/vnd.github+json' } })
    .then((response) => {
      if (!response.ok) throw new Error('No public release')
      return response.json()
    })
    .then((release) => {
      if (release.draft || release.prerelease || !Array.isArray(release.assets)) return

      const dmg = release.assets.find((asset) =>
        /^Astrolabe-.+-arm64\.dmg$/i.test(asset.name) &&
        !asset.name.toLowerCase().includes('unsigned'),
      )
      const checksum = release.assets.find((asset) => asset.name === 'SHA256SUMS.txt')
      const manifest = release.assets.find((asset) => asset.name === 'release-manifest.json')
      if (!dmg || !checksum || !manifest) return

      const state = card.querySelector('[data-release-state]')
      const message = card.querySelector('[data-release-message]')
      const download = card.querySelector('[data-release-download]')
      const meta = card.querySelector('[data-release-meta]')
      const notes = card.querySelector('[data-release-notes]')
      const date = formatDate(release.published_at)
      const size = formatBytes(dmg.size)

      card.dataset.releaseReady = 'true'
      state.textContent = 'Public release available'
      message.textContent = `Astrolabe ${release.tag_name} for Apple silicon is available as a release-qualified macOS disk image.`
      const downloadLink = document.createElement('a')
      downloadLink.className = 'button button--primary'
      downloadLink.dataset.releaseDownload = ''
      downloadLink.dataset.releaseAsset = dmg.name
      downloadLink.href = dmg.browser_download_url
      downloadLink.textContent = `Download ${release.tag_name}`
      download.replaceWith(downloadLink)
      meta.innerHTML = [
        '<span>Architecture</span><strong>Apple silicon (arm64)</strong>',
        date ? `<span>Published</span><strong>${date}</strong>` : '',
        size ? `<span>Download size</span><strong>${size}</strong>` : '',
        '<span>Integrity</span><strong>Checksum + manifest included</strong>',
      ].join('')
      notes.textContent = 'Release notes →'
      notes.href = release.html_url
    })
    .catch(() => {
      // The checked-in copy is already the truthful no-release state. Network
      // failures and GitHub API rate limits should never invent availability.
    })
})()
