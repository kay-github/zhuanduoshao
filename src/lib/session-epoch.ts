export function createSessionEpoch() {
  let currentEpoch = 0

  return {
    begin() {
      currentEpoch += 1
      return currentEpoch
    },
    capture() {
      return currentEpoch
    },
    isCurrent(epoch: number) {
      return epoch === currentEpoch
    },
  }
}
