import { readRelayStore, writeRelayStore } from '../src/store.js'

export const userSessionToken = 'user-1-session-token'

export const createDeviceInvite = async (dataPath: string, code: string) => {
  const store = await readRelayStore(dataPath)
  if (!store.users.some(user => user.id === 'user-1')) {
    store.users.push({
      createdAt: new Date().toISOString(),
      email: 'user-1@example.com',
      id: 'user-1',
      name: 'User 1',
      role: 'member'
    })
  }
  if (!store.sessions.some(session => session.token === userSessionToken)) {
    store.sessions.push({
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      lastSeenAt: new Date().toISOString(),
      token: userSessionToken,
      userId: 'user-1'
    })
  }
  store.invites.push({
    code,
    createdAt: new Date().toISOString(),
    maxUses: 1,
    role: 'member',
    used: 0,
    userId: 'user-1'
  })
  await writeRelayStore(dataPath, store)
}
