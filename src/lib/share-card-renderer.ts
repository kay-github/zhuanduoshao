import type { ShareCardData } from './share-card'

const CARD_WIDTH = 750
const CARD_PADDING = 56
const SCALE = 2

const COLORS = {
  backgroundTop: '#0a1527',
  backgroundBottom: '#091222',
  panel: 'rgba(255, 255, 255, 0.045)',
  panelBorder: 'rgba(145, 166, 223, 0.16)',
  title: '#8ca5d4',
  subtitle: '#c7d3ee',
  headlineProfit: '#21d7ba',
  headlineLoss: '#ff7d9c',
  label: '#8ca5d4',
  value: '#eef3ff',
  footer: '#8ca5d4',
  disclaimer: '#5f7195',
  accent: '#11d2bd',
} as const

function toneColor(tone: 'default' | 'profit' | 'loss') {
  if (tone === 'profit') {
    return COLORS.headlineProfit
  }

  if (tone === 'loss') {
    return COLORS.headlineLoss
  }

  return COLORS.value
}

function font(weight: number, size: number) {
  return `${weight} ${size}px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`
}

/**
 * Renders a share card into an offscreen canvas at 2x for crisp exports.
 * Height is computed from the line count so the card never clips.
 */
export function renderShareCard(card: ShareCardData): HTMLCanvasElement {
  const lineRowHeight = 64
  const height =
    CARD_PADDING + // top
    34 + // title row
    40 + // subtitle row
    36 + // gap
    96 + // headline (up to 2 rows)
    28 + // gap
    card.lines.length * lineRowHeight +
    36 + // gap
    58 + // footer + disclaimer
    CARD_PADDING // bottom

  const canvas = document.createElement('canvas')
  canvas.width = CARD_WIDTH * SCALE
  canvas.height = height * SCALE

  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('当前浏览器不支持图片生成')
  }

  context.scale(SCALE, SCALE)

  // Background gradient matching the app's dark theme.
  const gradient = context.createLinearGradient(0, 0, 0, height)
  gradient.addColorStop(0, COLORS.backgroundTop)
  gradient.addColorStop(1, COLORS.backgroundBottom)
  context.fillStyle = gradient
  context.fillRect(0, 0, CARD_WIDTH, height)

  // Accent bar on top.
  context.fillStyle = COLORS.accent
  context.fillRect(0, 0, CARD_WIDTH, 6)

  let cursorY = CARD_PADDING

  context.fillStyle = COLORS.title
  context.font = font(600, 24)
  context.textBaseline = 'top'
  context.fillText(card.title, CARD_PADDING, cursorY)
  cursorY += 34

  context.fillStyle = COLORS.subtitle
  context.font = font(400, 26)
  context.fillText(card.subtitle, CARD_PADDING, cursorY)
  cursorY += 40 + 36

  // Headline wraps onto two rows if too wide.
  context.fillStyle = card.headlineTone === 'loss' ? COLORS.headlineLoss : COLORS.headlineProfit
  context.font = font(700, 40)
  const maxTextWidth = CARD_WIDTH - CARD_PADDING * 2

  if (context.measureText(card.headline).width <= maxTextWidth) {
    context.fillText(card.headline, CARD_PADDING, cursorY + 20)
  } else {
    const splitIndex = card.headline.indexOf('，') + 1
    const firstRow = card.headline.slice(0, splitIndex)
    const secondRow = card.headline.slice(splitIndex)
    context.fillText(firstRow, CARD_PADDING, cursorY)
    context.fillText(secondRow, CARD_PADDING, cursorY + 52)
  }

  cursorY += 96 + 28

  // Metric rows inside a rounded panel.
  const panelTop = cursorY - 14
  const panelHeight = card.lines.length * 64 + 22
  context.fillStyle = COLORS.panel
  context.strokeStyle = COLORS.panelBorder
  context.beginPath()
  context.roundRect(CARD_PADDING - 20, panelTop, CARD_WIDTH - (CARD_PADDING - 20) * 2, panelHeight, 18)
  context.fill()
  context.stroke()

  for (const line of card.lines) {
    context.fillStyle = COLORS.label
    context.font = font(400, 26)
    context.fillText(line.label, CARD_PADDING, cursorY + 8)

    context.fillStyle = toneColor(line.tone)
    context.font = font(600, 30)
    context.textAlign = 'right'
    context.fillText(line.value, CARD_WIDTH - CARD_PADDING, cursorY + 6)
    context.textAlign = 'left'

    cursorY += 64
  }

  cursorY += 36

  context.fillStyle = COLORS.footer
  context.font = font(400, 22)
  context.fillText(card.footer, CARD_PADDING, cursorY)

  context.fillStyle = COLORS.disclaimer
  context.font = font(400, 20)
  context.fillText(card.disclaimer, CARD_PADDING, cursorY + 32)

  return canvas
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
      } else {
        reject(new Error('图片生成失败'))
      }
    }, 'image/png')
  })
}

/**
 * Shares the card through the system share sheet when available (mobile),
 * otherwise downloads it as a PNG file. Returns which path was taken.
 */
export async function exportShareCard(card: ShareCardData, fileName: string): Promise<'shared' | 'downloaded'> {
  const canvas = renderShareCard(card)
  const blob = await canvasToBlob(canvas)
  const file = new File([blob], fileName, { type: 'image/png' })

  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return 'shared'
    } catch (error) {
      // Fall through to download unless the user simply dismissed the sheet.
      if (error instanceof DOMException && error.name === 'AbortError') {
        return 'shared'
      }
    }
  }

  const objectUrl = URL.createObjectURL(blob)

  try {
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = fileName
    anchor.click()
  } finally {
    // Delay revocation so the download can start before the URL disappears.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000)
  }

  return 'downloaded'
}
