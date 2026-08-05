'use strict'
const descriptorFor = socket => {
  const descriptor = socket?._handle?.fd
  if (typeof descriptor === 'bigint') {
    const number = Number(descriptor)
    return Number.isSafeInteger(number) ? number : undefined
  }
  return Number.isSafeInteger(descriptor) && descriptor >= 0 ? descriptor : undefined
}
const verifySocketPeer = (binding, socket, serverSide) => {
  const descriptor = descriptorFor(socket)
  return descriptor != null && binding.verifyLocalPeer(descriptor, serverSide) === true
}
module.exports = { descriptorFor, verifySocketPeer }
