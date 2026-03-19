'use client'

export interface DocumentImageProcessingOptions {
  rotation: number
  enhanceScan: boolean
  trimMargins: boolean
  manualCrop?: DocumentCropRect | null
  maxDimension?: number
  minDimension?: number
}

export interface DocumentCropRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PreparedDocumentImage {
  blob: Blob
  width: number
  height: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function normalizeRotation(rotation: number) {
  const normalized = rotation % 360
  return normalized < 0 ? normalized + 360 : normalized
}

function normalizeCropRect(rect: DocumentCropRect) {
  const left = clamp(rect.x, 0, 1)
  const top = clamp(rect.y, 0, 1)
  const right = clamp(rect.x + rect.width, left, 1)
  const bottom = clamp(rect.y + rect.height, top, 1)

  return {
    x: left,
    y: top,
    width: clamp(right - left, 0.05, 1),
    height: clamp(bottom - top, 0.05, 1),
  }
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

function loadImage(file: Blob) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    const objectUrl = URL.createObjectURL(file)

    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Unable to load that image.'))
    }

    image.src = objectUrl
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality = 0.92) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Unable to prepare this image for OCR.'))
        return
      }
      resolve(blob)
    }, type, quality)
  })
}

function drawRotatedImage(
  image: HTMLImageElement,
  width: number,
  height: number,
  rotation: number,
) {
  const radians = (normalizeRotation(rotation) * Math.PI) / 180
  const quarterTurns = Math.round(normalizeRotation(rotation) / 90) % 4
  const canvas =
    quarterTurns % 2 === 0 ? createCanvas(width, height) : createCanvas(height, width)
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Unable to open a canvas context for this image.')
  }

  context.save()
  context.translate(canvas.width / 2, canvas.height / 2)
  context.rotate(radians)
  context.drawImage(image, -width / 2, -height / 2, width, height)
  context.restore()

  return canvas
}

function getLuminance(red: number, green: number, blue: number) {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function deriveThreshold(luminances: Float32Array) {
  let total = 0
  for (let index = 0; index < luminances.length; index += 1) {
    total += luminances[index] ?? 255
  }

  const average = total / Math.max(1, luminances.length)
  return clamp(average - 18, 152, 232)
}

function findContentBounds(
  luminances: Float32Array,
  width: number,
  height: number,
  threshold: number,
) {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const luminance = luminances[y * width + x] ?? 255
      if (luminance >= threshold) {
        continue
      }

      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }

  if (maxX < minX || maxY < minY) {
    return null
  }

  const padding = clamp(Math.round(Math.min(width, height) * 0.025), 10, 30)

  return {
    left: clamp(minX - padding, 0, width),
    top: clamp(minY - padding, 0, height),
    right: clamp(maxX + padding, 0, width),
    bottom: clamp(maxY + padding, 0, height),
  }
}

function cropCanvas(
  canvas: HTMLCanvasElement,
  bounds: { left: number; top: number; right: number; bottom: number } | null,
) {
  if (!bounds) {
    return canvas
  }

  const width = Math.max(1, bounds.right - bounds.left)
  const height = Math.max(1, bounds.bottom - bounds.top)
  const cropped = createCanvas(width, height)
  const context = cropped.getContext('2d')

  if (!context) {
    throw new Error('Unable to crop this image.')
  }

  context.drawImage(
    canvas,
    bounds.left,
    bounds.top,
    width,
    height,
    0,
    0,
    width,
    height,
  )

  return cropped
}

function boundsFromManualCrop(
  canvas: HTMLCanvasElement,
  crop: DocumentCropRect | null | undefined,
) {
  if (!crop) {
    return null
  }

  const normalized = normalizeCropRect(crop)
  return {
    left: Math.round(normalized.x * canvas.width),
    top: Math.round(normalized.y * canvas.height),
    right: Math.round((normalized.x + normalized.width) * canvas.width),
    bottom: Math.round((normalized.y + normalized.height) * canvas.height),
  }
}

function cloneCanvas(source: HTMLCanvasElement) {
  const next = createCanvas(source.width, source.height)
  const context = next.getContext('2d')

  if (!context) {
    throw new Error('Unable to copy this image.')
  }

  context.drawImage(source, 0, 0)
  return next
}

function enhanceCanvasForOcr(source: HTMLCanvasElement) {
  const next = cloneCanvas(source)
  const context = next.getContext('2d')

  if (!context) {
    throw new Error('Unable to adjust this image.')
  }

  const imageData = context.getImageData(0, 0, next.width, next.height)
  const { data } = imageData
  const luminances = new Float32Array(next.width * next.height)

  for (let index = 0; index < data.length; index += 4) {
    const luminance = getLuminance(
      data[index] ?? 255,
      data[index + 1] ?? 255,
      data[index + 2] ?? 255,
    )
    luminances[index / 4] = luminance
  }

  const threshold = deriveThreshold(luminances)

  for (let index = 0; index < data.length; index += 4) {
    const luminance = luminances[index / 4] ?? 255
    const boosted = clamp((luminance - 128) * 1.28 + 128, 0, 255)
    const value = boosted < threshold ? 0 : 255
    data[index] = value
    data[index + 1] = value
    data[index + 2] = value
  }

  context.putImageData(imageData, 0, 0)

  return {
    canvas: next,
    luminances,
    trimThreshold: threshold + 8,
  }
}

function inspectCanvas(source: HTMLCanvasElement) {
  const context = source.getContext('2d')

  if (!context) {
    throw new Error('Unable to inspect this image.')
  }

  const imageData = context.getImageData(0, 0, source.width, source.height)
  const luminances = new Float32Array(source.width * source.height)

  for (let index = 0; index < imageData.data.length; index += 4) {
    luminances[index / 4] = getLuminance(
      imageData.data[index] ?? 255,
      imageData.data[index + 1] ?? 255,
      imageData.data[index + 2] ?? 255,
    )
  }

  return {
    luminances,
    trimThreshold: clamp(deriveThreshold(luminances) + 10, 160, 242),
  }
}

export async function prepareDocumentImage(
  file: File,
  {
    rotation,
    enhanceScan,
    trimMargins,
    manualCrop,
    maxDimension = 1440,
    minDimension = 960,
  }: DocumentImageProcessingOptions,
): Promise<PreparedDocumentImage> {
  const image = await loadImage(file)
  const longestEdge = Math.max(image.naturalWidth, image.naturalHeight)
  const scale =
    longestEdge > maxDimension
      ? maxDimension / longestEdge
      : longestEdge < minDimension
        ? minDimension / longestEdge
        : 1

  const targetWidth = Math.max(1, Math.round(image.naturalWidth * scale))
  const targetHeight = Math.max(1, Math.round(image.naturalHeight * scale))
  const rotatedCanvas = drawRotatedImage(image, targetWidth, targetHeight, rotation)
  const manuallyCroppedCanvas = cropCanvas(
    rotatedCanvas,
    boundsFromManualCrop(rotatedCanvas, manualCrop),
  )

  let workingCanvas = manuallyCroppedCanvas
  let trimInfo = inspectCanvas(manuallyCroppedCanvas)

  if (enhanceScan) {
    const enhanced = enhanceCanvasForOcr(manuallyCroppedCanvas)
    workingCanvas = enhanced.canvas
    trimInfo = {
      luminances: enhanced.luminances,
      trimThreshold: enhanced.trimThreshold,
    }
  }

  const bounds = trimMargins
    ? findContentBounds(
        trimInfo.luminances,
        workingCanvas.width,
        workingCanvas.height,
        trimInfo.trimThreshold,
      )
    : null

  const outputCanvas = cropCanvas(workingCanvas, bounds)
  const blob = await canvasToBlob(outputCanvas)

  return {
    blob,
    width: outputCanvas.width,
    height: outputCanvas.height,
  }
}
