type CanvasExportDetail = {
  pixelRatio?: number
  resolve: (image: { dataUrl: string; width: number; height: number }) => void
  reject?: (error: Error) => void
}

const thumbnailKey = (projectId: string) => `homeplanner:project-thumbnail:${projectId}`

function requestPlanImage(pixelRatio = 1.5) {
  return new Promise<{ dataUrl: string; width: number; height: number } | null>((resolve) => {
    const timeout = window.setTimeout(() => resolve(null), 450)
    const detail: CanvasExportDetail = {
      pixelRatio,
      resolve: (image) => {
        window.clearTimeout(timeout)
        resolve(image)
      },
      reject: () => {
        window.clearTimeout(timeout)
        resolve(null)
      },
    }

    window.dispatchEvent(new CustomEvent('homeplanner:export-2d', { detail }))
  })
}

function downscaleImage(dataUrl: string, maxWidth = 720, maxHeight = 360) {
  return new Promise<string | null>((resolve) => {
    const image = new Image()
    image.onload = () => {
      const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1)
      const width = Math.max(1, Math.round(image.width * scale))
      const height = Math.max(1, Math.round(image.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) {
        resolve(null)
        return
      }

      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, width, height)
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(image, 0, 0, width, height)
      resolve(canvas.toDataURL('image/jpeg', 0.84))
    }
    image.onerror = () => resolve(null)
    image.src = dataUrl
  })
}

export function getProjectThumbnail(projectId: string) {
  try {
    return localStorage.getItem(thumbnailKey(projectId))
  } catch {
    return null
  }
}

export function removeProjectThumbnail(projectId: string) {
  try {
    localStorage.removeItem(thumbnailKey(projectId))
  } catch {
    // Ignore storage failures.
  }
}

export async function captureAndStoreProjectThumbnail(projectId: string) {
  const image = await requestPlanImage()
  if (!image) return null

  const thumbnail = await downscaleImage(image.dataUrl)
  if (!thumbnail) return null

  try {
    localStorage.setItem(thumbnailKey(projectId), thumbnail)
    return thumbnail
  } catch {
    return null
  }
}
