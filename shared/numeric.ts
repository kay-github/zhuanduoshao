export function hasAtMostDecimalPlaces(value: number, maximumDecimalPlaces: number) {
  if (!Number.isFinite(value) || !Number.isInteger(maximumDecimalPlaces) || maximumDecimalPlaces < 0) {
    return false
  }

  const [coefficient, exponentText = '0'] = Math.abs(value).toString().toLowerCase().split('e')
  const decimalPointIndex = coefficient.indexOf('.')
  const coefficientDecimalPlaces = decimalPointIndex === -1 ? 0 : coefficient.length - decimalPointIndex - 1
  const exponent = Number(exponentText)

  return Math.max(0, coefficientDecimalPlaces - exponent) <= maximumDecimalPlaces
}
